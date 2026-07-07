# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running multi-tenant Next.js 16 app: full database schema migrated, tenant resolved from the request host, all queries tenant-scoped, secrets encrypted, Google sign-in creating tenant-scoped users, and a tenant-branded base layout.

**Architecture:** Single Next.js 16 App Router app (no separate backend). Supabase hosts Postgres and Auth. Prisma is the only DB access path; a client extension injects `tenantId` into every query. Tenant is resolved per-request from the `Host` header by a cached server helper (NOT in middleware — Prisma cannot run on the edge runtime; middleware only refreshes the Supabase session).

**Tech Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS, Prisma 6 + Supabase Postgres, Supabase Auth (`@supabase/ssr`), Vitest, tsx (seed runner).

## Global Constraints

- Repo root: `notes-platform/` (this repo). App lives at repo root, no `src/` dir.
- TypeScript `strict: true` everywhere; no `any` except where a Prisma extension generic forces a cast (marked inline).
- All money values are **integer paise** (`pricePaise`, `totalPaise`). Never floats, never rupees.
- Every tenant-owned table has `tenantId`; application code reads/writes ONLY through `tenantDb(tenantId)` from `lib/tenant-db.ts`. Exceptions: tenant lookup itself (`lib/tenant.ts`) and Prisma migrations/seed.
- No Redis, no queue services. Background work uses the `FulfillmentJob` outbox table (consumed in Phase 3).
- Secrets (Razorpay keys) stored only via `encryptSecret()` (AES-256-GCM, `SECRETS_MASTER_KEY` env).
- Every new env var is added to `.env.example` in the same commit.
- Tests: Vitest, files in `tests/**/*.test.ts`, run with `npm test`. Commit after every green step.
- Windows dev machine: all commands must work in PowerShell (plain `npx`/`npm`/`git` — no bash-isms).

---

### Task 0: Manual prerequisites (human, one-time)

No code. Do these in browsers, record values in `.env` (created in Task 1).

- [ ] **Step 1:** Create a Supabase project (free tier, region `ap-south-1` Mumbai). From **Project Settings → Database**, copy the **Transaction pooler** URI (port 6543) and **Session pooler** URI (port 5432).
- [ ] **Step 2:** In Google Cloud Console, create a project `notes-platform`, configure the OAuth consent screen (External, only `email`/`profile`/`openid` scopes — these are non-sensitive; no verification hurdle), and create an **OAuth Client ID (Web application)**. Authorized redirect URI: `https://<your-supabase-ref>.supabase.co/auth/v1/callback`.
- [ ] **Step 3:** In Supabase **Authentication → Providers → Google**, paste the client ID/secret and enable it. In **Authentication → URL Configuration**, add `http://localhost:3000/**` to redirect URLs.
- [ ] **Step 4:** Generate the secrets master key and keep it for `.env`: run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

### Task 1: Scaffold Next.js 16 + Vitest

**Files:**
- Create: entire Next.js scaffold at repo root (create-next-app tolerates existing `docs/` and `.git/`)
- Create: `vitest.config.ts`, `tests/smoke.test.ts`, `.env.example`, `.env`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` (Vitest), `npm run dev` (Next.js on :3000), `@/*` import alias to repo root

- [ ] **Step 1: Scaffold in place**

```powershell
npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --turbopack
```

Expected: scaffold completes; `app/`, `package.json`, `tsconfig.json` exist. If it complains about the directory, the only allowed pre-existing entries are `.git` and `docs` — both are on create-next-app's allowlist, so this should not happen.

- [ ] **Step 2: Install and configure Vitest**

```powershell
npm install -D vitest
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

In `package.json` add to `"scripts"`: `"test": "vitest run"`.

- [ ] **Step 3: Write smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: Run tests and dev server**

Run: `npm test` → Expected: `1 passed`.
Run: `npm run dev`, open `http://localhost:3000` → Expected: Next.js starter page renders. Stop the server.

- [ ] **Step 5: Create env files**

Create `.env.example`:

```bash
# Supabase Postgres — Transaction pooler (runtime) and Session pooler (migrations)
DATABASE_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# Supabase Auth (Project Settings -> API)
NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"

# 64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SECRETS_MASTER_KEY="<64-hex-chars>"
```

Copy to `.env` and fill with the real values from Task 0. Verify `.gitignore` contains `.env*` (create-next-app adds it) — `.env` must never be committed.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "chore: scaffold Next.js 16 with Vitest and env template"
```

---

### Task 2: Prisma schema + migrations (incl. pg_trgm)

**Files:**
- Create: `prisma/schema.prisma`, `lib/db.ts`
- Create (generated + hand-edited): `prisma/migrations/*_init/`, `prisma/migrations/*_trigram_search/migration.sql`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DATABASE_URL`/`DIRECT_URL` from Task 1
- Produces: all models/enums below; `prisma` singleton export from `lib/db.ts`. Later tasks rely on these exact model/field names and the compound uniques `User @@unique([tenantId, authId])`, `Product @@unique([tenantId, slug])`, `Entitlement @@unique([tenantId, userId, productId])`.

- [ ] **Step 1: Install Prisma and write the full schema**

```powershell
npm install prisma @prisma/client
npm install -D tsx
```

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum TenantStatus      { ACTIVE SUSPENDED }
enum PaymentMode       { GATEWAY MANUAL_UPI }
enum DriveStatus       { UNVERIFIED VERIFIED ERROR }
enum Role              { STUDENT ADMIN }
enum ProductType       { NOTE BUNDLE }
enum Subject           { SCIENCE MATHS SST ENGLISH }
enum ProductStatus     { DRAFT ACTIVE ARCHIVED }
enum OrderStatus       { PENDING PENDING_VERIFICATION PAID FAILED REFUNDED }
enum EntitlementStatus { PENDING ACTIVE REVOKED }
enum JobType           { DRIVE_GRANT DELIVERY_EMAIL PREVIEW_GENERATION }
enum JobStatus         { PENDING RUNNING DONE DEAD }
enum EnquiryType       { UPDATE_NOTE NEW_TOPIC ISSUE }
enum EnquiryStatus     { OPEN RESOLVED }

model Tenant {
  id                       String       @id @default(cuid())
  slug                     String       @unique
  name                     String
  domains                  String[]
  isDefault                Boolean      @default(false)
  branding                 Json         @default("{}")
  supportEmail             String
  paymentMode              PaymentMode  @default(MANUAL_UPI)
  upiVpa                   String?
  razorpayKeyId            String?
  razorpayKeySecretEnc     String?
  razorpayWebhookSecretEnc String?
  driveRootFolderId        String?
  driveStatus              DriveStatus  @default(UNVERIFIED)
  status                   TenantStatus @default(ACTIVE)
  createdAt                DateTime     @default(now())
  updatedAt                DateTime     @updatedAt

  users        User[]
  products     Product[]
  aliases      ProductAlias[]
  orders       Order[]
  entitlements Entitlement[]
  jobs         FulfillmentJob[]
  enquiries    Enquiry[]
  blogPosts    BlogPost[]
  searchLogs   SearchLog[]
  webhookEvents WebhookEvent[]
}

model User {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  authId    String   // Supabase auth.users id (uuid)
  email     String
  name      String?
  role      Role     @default(STUDENT)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  orders       Order[]
  entitlements Entitlement[]

  @@unique([tenantId, authId])
  @@unique([tenantId, email])
}

model Product {
  id           String        @id @default(cuid())
  tenantId     String
  tenant       Tenant        @relation(fields: [tenantId], references: [id])
  type         ProductType
  slug         String
  title        String        // official NCERT title
  description  String        @default("")
  classLevel   Int           // 9 | 10
  subject      Subject
  chapterNo    Int?
  pricePaise   Int
  driveFileId  String?       // note products; null for bundles
  coverPath    String?       // Supabase Storage path
  previewPaths String[]      // watermarked preview images
  previewPages Int[]         // PDF pages to render (default [1,2,3], set in Phase 2)
  status       ProductStatus @default(DRAFT)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  aliases      ProductAlias[]
  bundleItems  BundleItem[]  @relation("bundle")
  inBundles    BundleItem[]  @relation("note")
  orderItems   OrderItem[]
  entitlements Entitlement[]

  @@unique([tenantId, slug])
  @@index([tenantId, status, classLevel, subject])
}

model BundleItem {
  id       String  @id @default(cuid())
  bundleId String
  bundle   Product @relation("bundle", fields: [bundleId], references: [id])
  noteId   String
  note     Product @relation("note", fields: [noteId], references: [id])

  @@unique([bundleId, noteId])
}

model ProductAlias {
  id        String  @id @default(cuid())
  tenantId  String
  tenant    Tenant  @relation(fields: [tenantId], references: [id])
  productId String
  product   Product @relation(fields: [productId], references: [id])
  alias     String

  @@index([tenantId])
}

model Order {
  id               String      @id @default(cuid())
  tenantId         String
  tenant           Tenant      @relation(fields: [tenantId], references: [id])
  userId           String
  user             User        @relation(fields: [userId], references: [id])
  status           OrderStatus @default(PENDING)
  totalPaise       Int
  paymentMode      PaymentMode
  gatewayOrderId   String?     // Razorpay order id
  gatewayPaymentId String?     // Razorpay payment id
  utrReference     String?     // manual UPI mode: buyer-submitted UTR
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  items OrderItem[]

  @@index([tenantId, status, createdAt])
}

model OrderItem {
  id            String  @id @default(cuid())
  orderId       String
  order         Order   @relation(fields: [orderId], references: [id])
  productId     String
  product       Product @relation(fields: [productId], references: [id])
  titleSnapshot String
  pricePaise    Int
}

model Entitlement {
  id                String            @id @default(cuid())
  tenantId          String
  tenant            Tenant            @relation(fields: [tenantId], references: [id])
  userId            String
  user              User              @relation(fields: [userId], references: [id])
  productId         String            // always a NOTE product (bundles expand)
  product           Product           @relation(fields: [productId], references: [id])
  drivePermissionId String?
  status            EntitlementStatus @default(PENDING)
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  @@unique([tenantId, userId, productId])
}

model FulfillmentJob {
  id          String    @id @default(cuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  type        JobType
  payload     Json
  status      JobStatus @default(PENDING)
  attempts    Int       @default(0)
  maxAttempts Int       @default(5)
  nextRunAt   DateTime  @default(now())
  lastError   String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([status, nextRunAt])
}

model WebhookEvent {
  id         String   @id // gateway event id — primary key IS the dedupe
  tenantId   String
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  receivedAt DateTime @default(now())
}

model Enquiry {
  id        String        @id @default(cuid())
  tenantId  String
  tenant    Tenant        @relation(fields: [tenantId], references: [id])
  type      EnquiryType
  name      String
  email     String
  message   String
  status    EnquiryStatus @default(OPEN)
  createdAt DateTime      @default(now())

  @@index([tenantId, status])
}

model BlogPost {
  id          String    @id @default(cuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id])
  slug        String
  title       String
  excerpt     String    @default("")
  contentMd   String
  coverPath   String?
  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([tenantId, slug])
}

model SearchLog {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  query       String
  resultCount Int
  createdAt   DateTime @default(now())

  @@index([tenantId, createdAt])
}
```

- [ ] **Step 2: Run the init migration**

```powershell
npx prisma migrate dev --name init
```

Expected: `Your database is now in sync with your schema` and `Generated Prisma Client`. (Uses `DIRECT_URL` automatically for the migration.)

- [ ] **Step 3: Add the trigram migration (hand-written SQL)**

```powershell
npx prisma migrate dev --create-only --name trigram_search
```

Edit the generated `prisma/migrations/*_trigram_search/migration.sql` to contain exactly:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_title_trgm_idx" ON "Product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ProductAlias_alias_trgm_idx" ON "ProductAlias" USING GIN ("alias" gin_trgm_ops);
```

Apply it:

```powershell
npx prisma migrate dev
```

Expected: migration applied without errors.

- [ ] **Step 4: Prisma client singleton**

Create `lib/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 5: Verify and commit**

Run: `npx prisma validate` → Expected: `The schema at prisma/schema.prisma is valid`.
Run: `npm test` → Expected: still green.

```powershell
git add -A
git commit -m "feat: full Prisma schema with tenant scoping fields and pg_trgm indexes"
```

---

### Task 3: Secrets encryption utility (TDD)

**Files:**
- Create: `lib/crypto.ts`
- Test: `tests/crypto.test.ts`

**Interfaces:**
- Consumes: `SECRETS_MASTER_KEY` env (64 hex chars)
- Produces: `encryptSecret(plain: string): string` and `decryptSecret(token: string): string` — token format `<iv-b64>.<authTag-b64>.<ciphertext-b64>`. Phase 3 stores Razorpay secrets with these.

- [ ] **Step 1: Write the failing tests**

Create `tests/crypto.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { encryptSecret, decryptSecret } from '@/lib/crypto'

describe('secrets crypto', () => {
  beforeEach(() => {
    process.env.SECRETS_MASTER_KEY = 'a'.repeat(64)
  })

  it('round-trips a secret', () => {
    const token = encryptSecret('rzp_test_abc123')
    expect(token).not.toContain('rzp_test_abc123')
    expect(decryptSecret(token)).toBe('rzp_test_abc123')
  })

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('rejects tampered ciphertext', () => {
    const token = encryptSecret('secret')
    const parts = token.split('.')
    const flipped = Buffer.from(parts[2], 'base64')
    flipped[0] = flipped[0] ^ 0xff
    parts[2] = flipped.toString('base64')
    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })

  it('throws a clear error when the master key is missing or malformed', () => {
    delete process.env.SECRETS_MASTER_KEY
    expect(() => encryptSecret('x')).toThrow(/SECRETS_MASTER_KEY/)
    process.env.SECRETS_MASTER_KEY = 'too-short'
    expect(() => encryptSecret('x')).toThrow(/SECRETS_MASTER_KEY/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` → Expected: FAIL — `Cannot find module '@/lib/crypto'` (or equivalent resolution error).

- [ ] **Step 3: Implement**

Create `lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'

function masterKey(): Buffer {
  const hex = process.env.SECRETS_MASTER_KEY
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('SECRETS_MASTER_KEY must be set to 64 hex characters')
  }
  return Buffer.from(hex, 'hex')
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, masterKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(token: string): string {
  const [ivB64, tagB64, dataB64] = token.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed secret token')
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test` → Expected: all crypto tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/crypto.test.ts lib/crypto.ts
git commit -m "feat: AES-256-GCM secret encryption for tenant credentials"
```

---

### Task 4: Tenant resolution from Host header (TDD)

**Files:**
- Create: `lib/tenant.ts`
- Test: `tests/tenant.test.ts`

**Interfaces:**
- Consumes: `prisma` from `lib/db.ts` (Task 2)
- Produces:
  - `pickTenantForHost<T extends { domains: string[]; isDefault: boolean }>(host: string | null, tenants: T[]): T | null` — pure, exported for tests
  - `getCurrentTenant(): Promise<Tenant>` — server-only helper; reads `headers()`, caches the tenant list 60s, throws if no tenant matches and no default exists. Every page/route in later phases calls this.

- [ ] **Step 1: Write the failing tests**

Create `tests/tenant.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickTenantForHost } from '@/lib/tenant'

const t = (slug: string, domains: string[], isDefault = false) => ({
  slug,
  domains,
  isDefault,
})

const tenants = [
  t('default', ['localhost'], true),
  t('sharma', ['sharmanotes.in', 'shop.sharmanotes.in']),
]

describe('pickTenantForHost', () => {
  it('matches an exact domain', () => {
    expect(pickTenantForHost('sharmanotes.in', tenants)?.slug).toBe('sharma')
  })

  it('ignores port and case, strips www', () => {
    expect(pickTenantForHost('WWW.SharmaNotes.in:443', tenants)?.slug).toBe('sharma')
    expect(pickTenantForHost('localhost:3000', tenants)?.slug).toBe('default')
  })

  it('matches subdomains listed explicitly', () => {
    expect(pickTenantForHost('shop.sharmanotes.in', tenants)?.slug).toBe('sharma')
  })

  it('falls back to the default tenant for unknown hosts', () => {
    expect(pickTenantForHost('unknown.example.com', tenants)?.slug).toBe('default')
  })

  it('returns null when nothing matches and there is no default', () => {
    expect(pickTenantForHost('x.com', [t('a', ['a.com'])])).toBeNull()
  })

  it('handles a null host', () => {
    expect(pickTenantForHost(null, tenants)?.slug).toBe('default')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` → Expected: FAIL — cannot resolve `@/lib/tenant`.

- [ ] **Step 3: Implement**

Create `lib/tenant.ts`:

```ts
import 'server-only'
import { headers } from 'next/headers'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/db'
import type { Tenant } from '@prisma/client'

function normalizeHost(host: string | null): string {
  return (host ?? '').toLowerCase().split(':')[0].replace(/^www\./, '')
}

export function pickTenantForHost<
  T extends { domains: string[]; isDefault: boolean },
>(host: string | null, tenants: T[]): T | null {
  const h = normalizeHost(host)
  const exact = tenants.find((t) =>
    t.domains.some((d) => normalizeHost(d) === h),
  )
  return exact ?? tenants.find((t) => t.isDefault) ?? null
}

const listActiveTenants = unstable_cache(
  async () => prisma.tenant.findMany({ where: { status: 'ACTIVE' } }),
  ['active-tenants'],
  { revalidate: 60 },
)

export async function getCurrentTenant(): Promise<Tenant> {
  const host = (await headers()).get('host')
  const tenant = pickTenantForHost(host, await listActiveTenants())
  if (!tenant) throw new Error(`No tenant configured for host "${host}"`)
  return tenant
}
```

Install the guard package:

```powershell
npm install server-only
```

Note: `tests/tenant.test.ts` imports only the pure `pickTenantForHost`. Vitest must not choke on `server-only`/`next/headers` — since the module is imported as a whole, mock them. Add to the TOP of `tests/tenant.test.ts` (before the `@/lib/tenant` import):

```ts
import { vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/db', () => ({ prisma: {} }))
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test` → Expected: all tenant tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/tenant.test.ts lib/tenant.ts package.json package-lock.json
git commit -m "feat: host-based tenant resolution with default fallback"
```

---

### Task 5: Tenant-scoped Prisma client (TDD)

**Files:**
- Create: `lib/tenant-scope.ts` (pure logic), `lib/tenant-db.ts` (Prisma extension)
- Test: `tests/tenant-scope.test.ts`

**Interfaces:**
- Consumes: `prisma` from `lib/db.ts`
- Produces:
  - `applyTenantScope(model: string, operation: string, args: Record<string, unknown> | undefined, tenantId: string): Record<string, unknown>` — pure, tested
  - `tenantDb(tenantId: string)` — the ONLY sanctioned DB handle for business code. Same API surface as `prisma` but every query on tenant-owned models is filtered/stamped with `tenantId`. Models exempt (scoped via parent or global): `Tenant`, `BundleItem`, `OrderItem`.

- [ ] **Step 1: Write the failing tests**

Create `tests/tenant-scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyTenantScope } from '@/lib/tenant-scope'

const TID = 'tenant_1'

describe('applyTenantScope', () => {
  it('injects tenantId into findMany where', () => {
    expect(
      applyTenantScope('Product', 'findMany', { where: { status: 'ACTIVE' } }, TID),
    ).toEqual({ where: { status: 'ACTIVE', tenantId: TID } })
  })

  it('creates a where clause when none exists', () => {
    expect(applyTenantScope('Product', 'findMany', undefined, TID)).toEqual({
      where: { tenantId: TID },
    })
  })

  it('injects into findUnique where (filtered unique)', () => {
    expect(
      applyTenantScope('Product', 'findUnique', { where: { id: 'p1' } }, TID),
    ).toEqual({ where: { id: 'p1', tenantId: TID } })
  })

  it('stamps create data', () => {
    expect(
      applyTenantScope('Product', 'create', { data: { title: 'X' } }, TID),
    ).toEqual({ data: { title: 'X', tenantId: TID } })
  })

  it('stamps every row in createMany', () => {
    expect(
      applyTenantScope('Product', 'createMany', { data: [{ title: 'A' }, { title: 'B' }] }, TID),
    ).toEqual({ data: [{ title: 'A', tenantId: TID }, { title: 'B', tenantId: TID }] })
  })

  it('scopes update/delete/count/aggregate/groupBy through where', () => {
    for (const op of ['update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy']) {
      const out = applyTenantScope('Order', op, { where: { id: 'o1' } }, TID)
      expect(out.where).toEqual({ id: 'o1', tenantId: TID })
    }
  })

  it('scopes upsert where and create, leaves update untouched', () => {
    const out = applyTenantScope(
      'User',
      'upsert',
      { where: { tenantId_authId: { tenantId: TID, authId: 'a1' } }, create: { authId: 'a1' }, update: { name: 'N' } },
      TID,
    )
    expect(out).toEqual({
      where: { tenantId_authId: { tenantId: TID, authId: 'a1' }, tenantId: TID },
      create: { authId: 'a1', tenantId: TID },
      update: { name: 'N' },
    })
  })

  it('leaves exempt models untouched', () => {
    for (const model of ['Tenant', 'BundleItem', 'OrderItem']) {
      const args = { where: { id: 'x' } }
      expect(applyTenantScope(model, 'findMany', args, TID)).toEqual(args)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` → Expected: FAIL — cannot resolve `@/lib/tenant-scope`.

- [ ] **Step 3: Implement the pure scoper**

Create `lib/tenant-scope.ts`:

```ts
const EXEMPT_MODELS = new Set(['Tenant', 'BundleItem', 'OrderItem'])

const WHERE_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow',
  'findUnique', 'findUniqueOrThrow',
  'update', 'updateMany', 'delete', 'deleteMany',
  'count', 'aggregate', 'groupBy',
])

type Args = Record<string, unknown>

export function applyTenantScope(
  model: string,
  operation: string,
  args: Args | undefined,
  tenantId: string,
): Args {
  if (EXEMPT_MODELS.has(model)) return args ?? {}
  const out: Args = { ...(args ?? {}) }

  if (WHERE_OPS.has(operation)) {
    out.where = { ...((out.where as Args) ?? {}), tenantId }
  }
  if (operation === 'create') {
    out.data = { ...((out.data as Args) ?? {}), tenantId }
  }
  if (operation === 'createMany') {
    out.data = ((out.data as Args[]) ?? []).map((d) => ({ ...d, tenantId }))
  }
  if (operation === 'upsert') {
    out.where = { ...((out.where as Args) ?? {}), tenantId }
    out.create = { ...((out.create as Args) ?? {}), tenantId }
  }
  return out
}
```

Create `lib/tenant-db.ts`:

```ts
import { prisma } from '@/lib/db'
import { applyTenantScope } from '@/lib/tenant-scope'

export function tenantDb(tenantId: string) {
  return prisma.$extends({
    name: `tenant-${tenantId}`,
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          // Prisma's generic arg types can't express the injection; the pure
          // function is unit-tested, so the cast is contained here.
          return query(applyTenantScope(model, operation, args as never, tenantId) as never)
        },
      },
    },
  })
}

export type TenantDb = ReturnType<typeof tenantDb>
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test` → Expected: all tenant-scope tests PASS.
Run: `npx tsc --noEmit` → Expected: no type errors.

- [ ] **Step 5: Commit**

```powershell
git add tests/tenant-scope.test.ts lib/tenant-scope.ts lib/tenant-db.ts
git commit -m "feat: tenant-scoped Prisma client via query extension"
```

---

### Task 6: Seed script (default tenant + sample catalog)

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (prisma seed hook)

**Interfaces:**
- Consumes: `prisma` singleton, schema from Task 2
- Produces: idempotent seed — a `default` tenant (domains `["localhost"]`, `isDefault: true`, `paymentMode: MANUAL_UPI`) plus 4 sample NOTE products with aliases and 1 BUNDLE. Later phases' manual testing depends on this data existing.

- [ ] **Step 1: Write the seed**

Create `prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      slug: 'default',
      name: 'Topper Notes Institute',
      domains: ['localhost'],
      isDefault: true,
      supportEmail: 'support@example.com',
      paymentMode: 'MANUAL_UPI',
      upiVpa: 'institute@upi',
      branding: { primaryColor: '#1d4ed8', accentColor: '#f59e0b' },
    },
  })

  const notes = [
    { slug: 'class-10-science-ch4-carbon-and-its-compounds', title: 'Carbon and its Compounds', classLevel: 10, subject: 'SCIENCE', chapterNo: 4, pricePaise: 9900, aliases: ['carbon', 'ch 4 science', 'carbon compounds', 'carbon notes'] },
    { slug: 'class-10-maths-ch1-real-numbers', title: 'Real Numbers', classLevel: 10, subject: 'MATHS', chapterNo: 1, pricePaise: 7900, aliases: ['real numbers', 'ch 1 maths', 'euclid division'] },
    { slug: 'class-9-sst-history-ch2-socialism-in-europe', title: 'Socialism in Europe and the Russian Revolution', classLevel: 9, subject: 'SST', chapterNo: 2, pricePaise: 6900, aliases: ['russian revolution', 'sst history ch 2', 'socialism'] },
    { slug: 'class-10-english-first-flight-ch1-a-letter-to-god', title: 'A Letter to God (First Flight)', classLevel: 10, subject: 'ENGLISH', chapterNo: 1, pricePaise: 4900, aliases: ['a letter to god', 'first flight ch 1', 'english ch 1'] },
  ] as const

  const noteIds: string[] = []
  for (const n of notes) {
    const product = await prisma.product.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: n.slug } },
      update: {},
      create: {
        tenantId: tenant.id,
        type: 'NOTE',
        slug: n.slug,
        title: n.title,
        classLevel: n.classLevel,
        subject: n.subject,
        chapterNo: n.chapterNo,
        pricePaise: n.pricePaise,
        status: 'ACTIVE',
        description: `Handwritten Class ${n.classLevel} ${n.subject} notes: ${n.title}.`,
        aliases: {
          create: n.aliases.map((alias) => ({ alias, tenantId: tenant.id })),
        },
      },
    })
    noteIds.push(product.id)
  }

  const scienceBundle = await prisma.product.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'class-10-science-complete-bundle' } },
    update: {},
    create: {
      tenantId: tenant.id,
      type: 'BUNDLE',
      slug: 'class-10-science-complete-bundle',
      title: 'Class 10 Science — Complete Bundle',
      classLevel: 10,
      subject: 'SCIENCE',
      pricePaise: 49900,
      status: 'ACTIVE',
      description: 'Every Class 10 Science chapter, one discounted bundle.',
    },
  })

  await prisma.bundleItem.upsert({
    where: { bundleId_noteId: { bundleId: scienceBundle.id, noteId: noteIds[0] } },
    update: {},
    create: { bundleId: scienceBundle.id, noteId: noteIds[0] },
  })

  console.log(`Seeded tenant "${tenant.slug}" with ${notes.length} notes + 1 bundle`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

Add to `package.json` (top level, next to `"scripts"`):

```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

- [ ] **Step 2: Run the seed (twice — idempotency check)**

Run: `npx prisma db seed` → Expected: `Seeded tenant "default" with 4 notes + 1 bundle`.
Run it again → Expected: same output, no unique-constraint errors.

- [ ] **Step 3: Verify data**

Run: `npx prisma studio`, open the `Product` table → Expected: 5 rows (4 notes, 1 bundle), aliases attached. Close studio.

- [ ] **Step 4: Commit**

```powershell
git add prisma/seed.ts package.json
git commit -m "feat: idempotent seed with default tenant and sample catalog"
```

---

### Task 7: Supabase Auth — Google sign-in + tenant-scoped user provisioning (TDD on mapping)

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/auth.ts`, `middleware.ts`, `app/auth/callback/route.ts`, `app/auth/error/page.tsx`, `components/auth-buttons.tsx`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Consumes: `getCurrentTenant()` (Task 4), `tenantDb()` (Task 5), Supabase env vars (Task 1)
- Produces:
  - `createSupabaseServerClient(): Promise<SupabaseClient>` (cookie-bound, for RSC/route handlers)
  - `createSupabaseBrowserClient(): SupabaseClient`
  - `mapAuthUser(authUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }): { email: string; name: string | null }` — pure, throws on missing email
  - `ensureUserRecord(tenantId: string, authUser: Parameters<typeof mapAuthUser>[0]): Promise<User>` — upsert by `(tenantId, authId)`
  - `getSessionUser(): Promise<User | null>` — current tenant + Supabase session → app `User` row (used by every authed page later)

- [ ] **Step 1: Install and write failing tests**

```powershell
npm install @supabase/supabase-js @supabase/ssr
```

Create `tests/auth.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/tenant-db', () => ({ tenantDb: vi.fn() }))

import { mapAuthUser } from '@/lib/auth'

describe('mapAuthUser', () => {
  it('extracts email and full name from metadata', () => {
    expect(
      mapAuthUser({ id: 'u1', email: 'kid@gmail.com', user_metadata: { full_name: 'Kid Kumar' } }),
    ).toEqual({ email: 'kid@gmail.com', name: 'Kid Kumar' })
  })

  it('falls back to name, then null', () => {
    expect(
      mapAuthUser({ id: 'u1', email: 'a@b.com', user_metadata: { name: 'A' } }).name,
    ).toBe('A')
    expect(mapAuthUser({ id: 'u1', email: 'a@b.com' }).name).toBeNull()
  })

  it('lowercases the email', () => {
    expect(mapAuthUser({ id: 'u1', email: 'Kid@Gmail.COM' }).email).toBe('kid@gmail.com')
  })

  it('throws when the auth user has no email', () => {
    expect(() => mapAuthUser({ id: 'u1' })).toThrow(/email/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` → Expected: FAIL — cannot resolve `@/lib/auth`.

- [ ] **Step 3: Implement auth module and Supabase clients**

Create `lib/supabase/server.ts`:

```ts
import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // called from a Server Component — middleware refreshes sessions instead
          }
        },
      },
    },
  )
}
```

Create `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

Create `lib/auth.ts`:

```ts
import 'server-only'
import type { User } from '@prisma/client'
import { tenantDb } from '@/lib/tenant-db'
import { getCurrentTenant } from '@/lib/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type AuthUserLike = {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
}

export function mapAuthUser(authUser: AuthUserLike): { email: string; name: string | null } {
  if (!authUser.email) {
    throw new Error('Auth user has no email — Google sign-in must provide one')
  }
  const meta = authUser.user_metadata ?? {}
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null
  return { email: authUser.email.toLowerCase(), name }
}

export async function ensureUserRecord(tenantId: string, authUser: AuthUserLike): Promise<User> {
  const { email, name } = mapAuthUser(authUser)
  const db = tenantDb(tenantId)
  return db.user.upsert({
    where: { tenantId_authId: { tenantId, authId: authUser.id } },
    create: { authId: authUser.id, email, name },
    update: { email, name },
  }) as Promise<User>
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return null
  const tenant = await getCurrentTenant()
  const db = tenantDb(tenant.id)
  return db.user.findUnique({
    where: { tenantId_authId: { tenantId: tenant.id, authId: data.user.id } },
  }) as Promise<User | null>
}
```

Create `middleware.ts` (repo root — session refresh only, NO Prisma here, it runs on the edge):

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )
  await supabase.auth.getUser() // refreshes expired sessions
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

Create `app/auth/callback/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ensureUserRecord } from '@/lib/auth'
import { getCurrentTenant } from '@/lib/tenant'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      const tenant = await getCurrentTenant()
      await ensureUserRecord(tenant.id, data.user)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }
  return NextResponse.redirect(`${origin}/auth/error`)
}
```

Create `app/auth/error/page.tsx`:

```tsx
export default function AuthErrorPage() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold">Sign-in failed</h1>
      <p className="mt-2 text-sm text-gray-600">
        Something went wrong signing you in with Google. Please go back and try again.
      </p>
    </main>
  )
}
```

Create `components/auth-buttons.tsx`:

```tsx
'use client'

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export function SignInButton() {
  const signIn = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }
  return (
    <button onClick={signIn} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white">
      Sign in with Google
    </button>
  )
}

export function SignOutButton() {
  const signOut = async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    window.location.assign('/')
  }
  return (
    <button onClick={signOut} className="rounded-md border px-4 py-2 text-sm">
      Sign out
    </button>
  )
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test` → Expected: all tests PASS (auth mapping included).
Run: `npx tsc --noEmit` → Expected: clean.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Visit `http://localhost:3000` — the starter page still renders (sign-in UI is wired into the layout in Task 8, but you can hit the flow directly): temporarily confirm by opening `http://localhost:3000/auth/error` (renders the error page). Full sign-in loop is verified at the end of Task 8.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: Supabase Google auth with tenant-scoped user provisioning"
```

---

### Task 8: Tenant-branded layout, header, health route

**Files:**
- Create: `lib/branding.ts`, `components/site-header.tsx`, `app/api/health/route.ts`
- Modify: `app/layout.tsx`, `app/page.tsx`
- Test: `tests/branding.test.ts`

**Interfaces:**
- Consumes: `getCurrentTenant()`, `getSessionUser()`, `SignInButton`/`SignOutButton`
- Produces:
  - `brandingToCssVars(branding: unknown): Record<string, string>` — pure; safe defaults for missing/garbage JSON
  - `GET /api/health` → `{ ok: true, tenant: string, db: boolean }`
  - Root layout applies tenant CSS vars + header. Phase 2 pages render inside this shell.

- [ ] **Step 1: Write the failing test**

Create `tests/branding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { brandingToCssVars } from '@/lib/branding'

describe('brandingToCssVars', () => {
  it('maps known keys to CSS variables', () => {
    expect(brandingToCssVars({ primaryColor: '#112233', accentColor: '#445566' })).toEqual({
      '--brand-primary': '#112233',
      '--brand-accent': '#445566',
    })
  })

  it('applies defaults for missing keys and non-object input', () => {
    const defaults = { '--brand-primary': '#1d4ed8', '--brand-accent': '#f59e0b' }
    expect(brandingToCssVars({})).toEqual(defaults)
    expect(brandingToCssVars(null)).toEqual(defaults)
    expect(brandingToCssVars('junk')).toEqual(defaults)
  })

  it('ignores values that are not hex colors', () => {
    expect(brandingToCssVars({ primaryColor: 'javascript:alert(1)' })['--brand-primary']).toBe('#1d4ed8')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` → Expected: FAIL — cannot resolve `@/lib/branding`.

- [ ] **Step 3: Implement branding, header, health, layout**

Create `lib/branding.ts`:

```ts
const HEX = /^#[0-9a-f]{3,8}$/i

const DEFAULTS = {
  '--brand-primary': '#1d4ed8',
  '--brand-accent': '#f59e0b',
} as const

export function brandingToCssVars(branding: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULTS }
  if (branding && typeof branding === 'object') {
    const b = branding as Record<string, unknown>
    if (typeof b.primaryColor === 'string' && HEX.test(b.primaryColor)) {
      out['--brand-primary'] = b.primaryColor
    }
    if (typeof b.accentColor === 'string' && HEX.test(b.accentColor)) {
      out['--brand-accent'] = b.accentColor
    }
  }
  return out
}
```

Create `components/site-header.tsx`:

```tsx
import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { getCurrentTenant } from '@/lib/tenant'
import { SignInButton, SignOutButton } from '@/components/auth-buttons'

export async function SiteHeader() {
  const [tenant, user] = await Promise.all([getCurrentTenant(), getSessionUser()])
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
        <Link href="/" className="text-lg font-bold" style={{ color: 'var(--brand-primary)' }}>
          {tenant.name}
        </Link>
        <nav className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-gray-600">{user.name ?? user.email}</span>
              <SignOutButton />
            </>
          ) : (
            <SignInButton />
          )}
        </nav>
      </div>
    </header>
  )
}
```

Create `app/api/health/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentTenant } from '@/lib/tenant'

export async function GET() {
  try {
    const tenant = await getCurrentTenant()
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, tenant: tenant.slug, db: true })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    )
  }
}
```

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'
import { getCurrentTenant } from '@/lib/tenant'
import { brandingToCssVars } from '@/lib/branding'
import { SiteHeader } from '@/components/site-header'

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant()
  return {
    title: { default: tenant.name, template: `%s | ${tenant.name}` },
    description: `Handwritten notes by ${tenant.name}`,
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getCurrentTenant()
  return (
    <html lang="en" style={brandingToCssVars(tenant.branding)}>
      <body className="min-h-screen antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  )
}
```

Replace `app/page.tsx`:

```tsx
import { getCurrentTenant } from '@/lib/tenant'

export default async function HomePage() {
  const tenant = await getCurrentTenant()
  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-3xl font-bold">
        Handwritten notes that make Class 9 &amp; 10 easy
      </h1>
      <p className="mt-2 text-gray-600">
        {tenant.name} — full storefront lands in Phase 2.
      </p>
    </main>
  )
}
```

- [ ] **Step 4: Run tests, typecheck, and verify end-to-end**

Run: `npm test` → Expected: all suites PASS.
Run: `npx tsc --noEmit` → Expected: clean.
Run: `npm run dev`, then:
1. `http://localhost:3000/api/health` → Expected: `{"ok":true,"tenant":"default","db":true}`.
2. `http://localhost:3000` → Expected: header shows **Topper Notes Institute** in the brand color, "Sign in with Google" button visible.
3. Click sign-in, complete Google OAuth → Expected: redirected back, header shows your name.
4. `npx prisma studio` → `User` table has one row with your email, `role = STUDENT`, correct `tenantId`.

- [ ] **Step 5: Commit — Phase 1 complete**

```powershell
git add -A
git commit -m "feat: tenant-branded layout, header with auth state, health endpoint"
```

---

## Phase 1 exit criteria

- `npm test` green (crypto, tenant resolution, tenant scoping, auth mapping, branding).
- `npx tsc --noEmit` clean.
- `/api/health` returns the seeded tenant with `db: true`.
- Google sign-in produces a tenant-scoped `User` row.
- Schema migrated including `pg_trgm` + trigram indexes (verify in Supabase SQL editor: `SELECT * FROM pg_extension WHERE extname = 'pg_trgm';` returns one row).

**Next:** write `phase-2-catalog-search` plan (products/bundles admin CRUD, Drive client + preview generation, PLP/PDP, academic search).
