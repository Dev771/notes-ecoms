# Phase 1 (v2, split architecture): Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running split platform — `client/` (Next.js 16) + `server/` (NestJS 11) — with the full schema migrated, tenant resolution on the API, all queries tenant-scoped, secrets encrypted, Supabase Google sign-in creating tenant-scoped users via a JWT-guarded sync endpoint, and a tenant-branded storefront shell.

**Architecture:** Plain two-app monorepo (`client/`, `server/`; no workspace tooling). The NestJS server owns Postgres, Prisma, secrets, and business logic; the Next.js client holds no secrets and calls the API with a Supabase access token. Tenant is resolved per API request from the `Origin` header (fallback `Host`) by a Nest middleware; the client fetches branding from `GET /tenant/config`.

**Tech Stack:** Next.js 16 + Tailwind + Vitest (client). NestJS 11 + Prisma 6 + Jest + `jose` (server). Supabase (Postgres + Auth). tsx (seed runner). concurrently (root dev script).

**Supersedes:** `2026-07-07-phase-1-foundation.md` (single-app v1). Its Task 1 (root Next.js scaffold, commit `1e3a982`) is already executed; Task 2 below relocates it.

## Global Constraints

- Repo root `notes-platform/`. Apps live in `client/` and `server/`; each has its own `package.json`. Root `package.json` only orchestrates (`npm run dev` runs both via `concurrently`).
- TypeScript `strict: true` in both apps; no `any` except where a Prisma extension generic forces a cast (marked inline).
- All money values are **integer paise** (`pricePaise`, `totalPaise`). Never floats, never rupees.
- Every tenant-owned table has `tenantId`; server code reads/writes ONLY through `PrismaService.forTenant(tenantId)`. Exceptions: tenant lookup (`TenantService`) and Prisma migrations/seed.
- The client never imports Prisma, never sees `SECRETS_MASTER_KEY`, `DATABASE_URL`, or any Razorpay/Drive credential. Client env is only `NEXT_PUBLIC_*` values.
- No Redis, no queue services. Background work uses the `FulfillmentJob` outbox table (worker lands in Phase 3).
- Secrets (Razorpay keys) stored only via `encryptSecret()` (AES-256-GCM, `SECRETS_MASTER_KEY` env, server-side).
- Every new env var is added to that app's `.env.example` in the same commit. `.env` / `.env.local` are never committed.
- Tests — server: Jest, colocated `src/**/*.spec.ts`, run with `npm test` inside `server/`. Client: Vitest, `tests/**/*.test.ts`, run with `npm test` inside `client/`. Commit after every green step.
- Windows dev machine: all commands must work in PowerShell (plain `npx`/`npm`/`git` — no bash-isms). Next.js 16 note: before writing client code, check `client/node_modules/next/dist/docs/` for current conventions (repo AGENTS.md mandates this).
- API dev port **3001**; web dev port **3000**.

---

### Task 0: Manual prerequisites (human, one-time)

No code. Do these in browsers; values go into `server/.env` and `client/.env.local` (created in Tasks 2–3).

- [ ] **Step 1:** Create a Supabase project (free tier, region `ap-south-1` Mumbai). From **Project Settings → Database**, copy the **Transaction pooler** URI (port 6543) and **Session pooler** URI (port 5432).
- [ ] **Step 2:** In Google Cloud Console, create a project `notes-platform`, configure the OAuth consent screen (External; only `email`/`profile`/`openid` scopes — non-sensitive, no verification hurdle), and create an **OAuth Client ID (Web application)** with authorized redirect URI `https://<your-supabase-ref>.supabase.co/auth/v1/callback`.
- [ ] **Step 3:** In Supabase **Authentication → Providers → Google**, paste the client ID/secret and enable. In **Authentication → URL Configuration**, add `http://localhost:3000/**` to redirect URLs.
- [ ] **Step 4:** In Supabase **Project Settings → JWT Keys**, confirm the project uses **asymmetric JWT signing keys** (ES256/RS256 — default on new projects; migrate if it shows legacy HS256). The API verifies tokens against `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`.
- [ ] **Step 5:** Generate the secrets master key and keep it for `server/.env`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

### Task 1: Root Next.js scaffold — ALREADY EXECUTED (commit `1e3a982`)

Kept for the record. The scaffold currently sits at repo root; Task 2 moves it into `client/`. Do not re-run.

---

### Task 2: Restructure into client/ + root orchestration

**Files:**
- Move (git mv): `app/`, `public/`, `tests/`, `.env.example`, `eslint.config.mjs`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `package.json`, `package-lock.json`, `next-env.d.ts` → same names under `client/`
- Move: `AGENTS.md`, `CLAUDE.md` stay at repo root (they are repo-wide agent guidance)
- Create: root `package.json` (orchestration only), `client/.env.local`
- Modify: root `.gitignore`, `client/.env.example`

**Interfaces:**
- Consumes: the Task 1 scaffold
- Produces: `client/` is a self-contained Next.js app (`npm test`, `npm run dev` work inside it); root `npm run dev` will run both apps once Task 3 adds the server. Client env contract: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`.

- [ ] **Step 1: Move the scaffold**

```powershell
New-Item -ItemType Directory client | Out-Null
git mv app client/app; git mv public client/public; git mv tests client/tests
git mv .env.example client/.env.example; git mv eslint.config.mjs client/eslint.config.mjs
git mv next.config.ts client/next.config.ts; git mv postcss.config.mjs client/postcss.config.mjs
git mv tsconfig.json client/tsconfig.json; git mv vitest.config.ts client/vitest.config.ts
git mv package.json client/package.json; git mv package-lock.json client/package-lock.json
git mv next-env.d.ts client/next-env.d.ts
Move-Item .env client/.env.local
Move-Item node_modules client/node_modules
```

(If `git mv next-env.d.ts` fails because it's untracked/generated, plain `Move-Item` it.)

- [ ] **Step 2: Rewrite client env template**

Replace `client/.env.example` with ONLY the client-safe values:

```bash
# Supabase Auth (Project Settings -> API)
NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"

# NestJS API base URL
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

Update `client/.env.local` to the same three keys (real values if Task 0 is done, placeholders otherwise). DB URLs and `SECRETS_MASTER_KEY` move to `server/.env.example` in Task 3 — they must NOT remain in any client env file.

- [ ] **Step 3: Root orchestration package.json**

Create root `package.json`:

```json
{
  "name": "notes-platform",
  "private": true,
  "scripts": {
    "dev": "concurrently -n web,api -c blue,green \"npm --prefix client run dev\" \"npm --prefix server run start:dev\"",
    "dev:client": "npm --prefix client run dev",
    "dev:server": "npm --prefix server run start:dev",
    "test": "npm --prefix client test && npm --prefix server test"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

```powershell
npm install
```

Append to root `.gitignore` (keep existing entries):

```
node_modules/
```

- [ ] **Step 4: Verify the client still works from its new home**

Run: `npm --prefix client test` → Expected: 1 passed (smoke test).
Run: `npm --prefix client run dev`, open `http://localhost:3000` → Expected: starter page renders. Stop it.
(If Next complains about a stale `.next/` cache after the move: delete `client/.next` and retry.)

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "refactor: move Next.js app into client/ and add root orchestration"
```

---

### Task 3: Scaffold NestJS server

**Files:**
- Create: entire Nest scaffold under `server/` (via CLI), `server/.env.example`, `server/.env`
- Modify: `server/src/main.ts`, `server/src/app.module.ts`, add `server/src/health/health.controller.ts` + `server/src/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: nothing from client
- Produces: API on :3001 with CORS for the web origin; `GET /health` → `{ ok: true }`; `@nestjs/config` loaded globally; Jest running via `npm test` inside `server/`. Later tasks add modules to `AppModule`.

- [ ] **Step 1: Scaffold**

```powershell
npx @nestjs/cli@latest new server --package-manager npm --strict --skip-git
```

Expected: `server/` created with `src/`, Jest config in `package.json`, TypeScript strict.

```powershell
npm --prefix server install @nestjs/config
```

- [ ] **Step 2: Configure main.ts (port, CORS, validation-ready)**

Replace `server/src/main.ts`:

```ts
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({
    origin: true, // reflects request origin; tenant validation happens in TenantMiddleware
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
  await app.listen(process.env.PORT ?? 3001)
}
void bootstrap()
```

In `server/src/app.module.ts`, add config:

```ts
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { HealthController } from './health/health.controller'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Write the failing health test**

Create `server/src/health/health.controller.spec.ts`:

```ts
import { HealthController } from './health.controller'

describe('HealthController', () => {
  it('reports ok', () => {
    expect(new HealthController().check()).toEqual({ ok: true })
  })
})
```

Run: `npm --prefix server test` → Expected: FAIL — `Cannot find module './health.controller'`.

- [ ] **Step 4: Implement**

Create `server/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  check(): { ok: boolean } {
    return { ok: true }
  }
}
```

Run: `npm --prefix server test` → Expected: PASS (health + scaffold's app.controller spec).
Run: `npm --prefix server run start:dev`, open `http://localhost:3001/health` → Expected: `{"ok":true}`. Stop it.

- [ ] **Step 5: Server env files**

Create `server/.env.example`:

```bash
PORT=3001

# Supabase Postgres — Transaction pooler (runtime) and Session pooler (migrations)
DATABASE_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# Supabase project URL — used for JWKS token verification (auth/v1/.well-known/jwks.json)
SUPABASE_URL="https://<project-ref>.supabase.co"

# 64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SECRETS_MASTER_KEY="<64-hex-chars>"
```

Copy to `server/.env` (real values if Task 0 done, else placeholders). Verify `server/.gitignore` or root `.gitignore` covers `server/.env` (root has `.env`; Nest scaffold's gitignore covers `.env` too — confirm with `git status`, `.env` must not appear).

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat: scaffold NestJS server with health endpoint and config module"
```

---

### Task 4: Prisma schema + migrations in server/

**Files:**
- Create: `server/prisma/schema.prisma`, `server/src/prisma/prisma.service.ts`, `server/src/prisma/prisma.module.ts`
- Create (generated + hand-edited): `server/prisma/migrations/*_init/`, `server/prisma/migrations/*_trigram_search/migration.sql`
- Modify: `server/package.json`, `server/src/app.module.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`/`DIRECT_URL` from `server/.env` (Task 0 values required for the migrate steps)
- Produces: all models/enums below; global `PrismaModule` exporting `PrismaService` (extends `PrismaClient`). Later tasks rely on these exact model/field names and the compound uniques `User @@unique([tenantId, authId])`, `Product @@unique([tenantId, slug])`, `Entitlement @@unique([tenantId, userId, productId])`.

- [ ] **Step 1: Install and write the full schema**

```powershell
npm --prefix server install prisma @prisma/client
npm --prefix server install -D tsx
```

Create `server/prisma/schema.prisma`:

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

  users         User[]
  products      Product[]
  aliases       ProductAlias[]
  orders        Order[]
  entitlements  Entitlement[]
  jobs          FulfillmentJob[]
  enquiries     Enquiry[]
  blogPosts     BlogPost[]
  searchLogs    SearchLog[]
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

- [ ] **Step 2: Run the init migration** (requires real DB URLs in `server/.env`)

```powershell
cd server; npx prisma migrate dev --name init; cd ..
```

Expected: `Your database is now in sync with your schema` + `Generated Prisma Client`.

- [ ] **Step 3: Trigram migration (hand-written SQL)**

```powershell
cd server; npx prisma migrate dev --create-only --name trigram_search; cd ..
```

Edit `server/prisma/migrations/*_trigram_search/migration.sql` to exactly:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_title_trgm_idx" ON "Product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ProductAlias_alias_trgm_idx" ON "ProductAlias" USING GIN ("alias" gin_trgm_ops);
```

Apply: `cd server; npx prisma migrate dev; cd ..` → Expected: applied cleanly.

- [ ] **Step 4: PrismaService + module**

Create `server/src/prisma/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
```

Create `server/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Add `PrismaModule` to `AppModule` imports.

- [ ] **Step 5: Verify and commit**

Run: `cd server; npx prisma validate; cd ..` → Expected: schema valid.
Run: `npm --prefix server test` → Expected: green.

```powershell
git add -A
git commit -m "feat: full Prisma schema, migrations with pg_trgm, PrismaService"
```

---

### Task 5: Secrets encryption utility (TDD, server)

**Files:**
- Create: `server/src/common/crypto.ts`
- Test: `server/src/common/crypto.spec.ts`

**Interfaces:**
- Consumes: `SECRETS_MASTER_KEY` env (64 hex chars)
- Produces: `encryptSecret(plain: string): string`, `decryptSecret(token: string): string` — token format `<iv-b64>.<authTag-b64>.<ciphertext-b64>`. Phase 3 stores Razorpay secrets with these.

- [ ] **Step 1: Write the failing tests**

Create `server/src/common/crypto.spec.ts`:

```ts
import { decryptSecret, encryptSecret } from './crypto'

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
    const parts = encryptSecret('secret').split('.')
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

Run: `npm --prefix server test` → Expected: FAIL — cannot find `./crypto`.

- [ ] **Step 3: Implement**

Create `server/src/common/crypto.ts`:

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

Run: `npm --prefix server test` → Expected: crypto suite PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/common
git commit -m "feat: AES-256-GCM secret encryption for tenant credentials"
```

---

### Task 6: Tenant resolution middleware (TDD, server)

**Files:**
- Create: `server/src/tenant/tenant-resolver.ts`, `server/src/tenant/tenant.service.ts`, `server/src/tenant/tenant.middleware.ts`, `server/src/tenant/tenant.module.ts`, `server/src/tenant/current-tenant.decorator.ts`
- Test: `server/src/tenant/tenant-resolver.spec.ts`, `server/src/tenant/tenant.middleware.spec.ts`
- Modify: `server/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`
- Produces:
  - `pickTenantForHost<T extends { domains: string[]; isDefault: boolean }>(host: string | null, tenants: T[]): T | null` — pure
  - `TenantService.resolveByHost(host: string | null): Promise<Tenant | null>` — 60s in-memory cache of active tenants
  - `TenantMiddleware` — resolves from `Origin` (fallback `Host`), attaches `req.tenant`, 404s unknown hosts with no default
  - `@CurrentTenant()` param decorator returning `req.tenant`
  - Applied to all routes except `health`. Every later controller uses `@CurrentTenant()`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/tenant/tenant-resolver.spec.ts`:

```ts
import { pickTenantForHost } from './tenant-resolver'

const t = (slug: string, domains: string[], isDefault = false) => ({ slug, domains, isDefault })

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

Create `server/src/tenant/tenant.middleware.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common'
import { TenantMiddleware } from './tenant.middleware'
import type { TenantService } from './tenant.service'

const tenant = { id: 't1', slug: 'default' }

function middlewareWith(resolved: unknown) {
  const service = {
    resolveByHost: jest.fn().mockResolvedValue(resolved),
  } as unknown as TenantService
  return { mw: new TenantMiddleware(service), service }
}

describe('TenantMiddleware', () => {
  it('resolves from the Origin header host', async () => {
    const { mw, service } = middlewareWith(tenant)
    const req: Record<string, unknown> = { headers: { origin: 'https://sharmanotes.in', host: 'api.internal:3001' } }
    const next = jest.fn()
    await mw.use(req as never, {} as never, next)
    expect(service.resolveByHost).toHaveBeenCalledWith('sharmanotes.in')
    expect(req.tenant).toBe(tenant)
    expect(next).toHaveBeenCalled()
  })

  it('falls back to Host when Origin is absent', async () => {
    const { mw, service } = middlewareWith(tenant)
    const req: Record<string, unknown> = { headers: { host: 'localhost:3001' } }
    await mw.use(req as never, {} as never, jest.fn())
    expect(service.resolveByHost).toHaveBeenCalledWith('localhost:3001')
  })

  it('throws NotFound when no tenant resolves', async () => {
    const { mw } = middlewareWith(null)
    const req = { headers: { host: 'nowhere.com' } }
    await expect(mw.use(req as never, {} as never, jest.fn())).rejects.toThrow(NotFoundException)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix server test` → Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `server/src/tenant/tenant-resolver.ts`:

```ts
function normalizeHost(host: string | null): string {
  return (host ?? '').toLowerCase().split(':')[0].replace(/^www\./, '')
}

export function pickTenantForHost<
  T extends { domains: string[]; isDefault: boolean },
>(host: string | null, tenants: T[]): T | null {
  const h = normalizeHost(host)
  const exact = tenants.find((t) => t.domains.some((d) => normalizeHost(d) === h))
  return exact ?? tenants.find((t) => t.isDefault) ?? null
}
```

Create `server/src/tenant/tenant.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { Tenant } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { pickTenantForHost } from './tenant-resolver'

const CACHE_TTL_MS = 60_000

@Injectable()
export class TenantService {
  private cache: { tenants: Tenant[]; fetchedAt: number } | null = null

  constructor(private readonly prisma: PrismaService) {}

  private async activeTenants(): Promise<Tenant[]> {
    if (!this.cache || Date.now() - this.cache.fetchedAt > CACHE_TTL_MS) {
      const tenants = await this.prisma.tenant.findMany({ where: { status: 'ACTIVE' } })
      this.cache = { tenants, fetchedAt: Date.now() }
    }
    return this.cache.tenants
  }

  async resolveByHost(host: string | null): Promise<Tenant | null> {
    return pickTenantForHost(host, await this.activeTenants())
  }
}
```

Create `server/src/tenant/tenant.middleware.ts`:

```ts
import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { TenantService } from './tenant.service'

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const origin = req.headers.origin
    let host: string | null = null
    if (typeof origin === 'string') {
      try {
        host = new URL(origin).host
      } catch {
        host = null
      }
    }
    host = host ?? req.headers.host ?? null
    const tenant = await this.tenants.resolveByHost(host)
    if (!tenant) throw new NotFoundException(`No tenant configured for host "${host}"`)
    ;(req as Request & { tenant: unknown }).tenant = tenant
    next()
  }
}
```

Create `server/src/tenant/current-tenant.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Tenant } from '@prisma/client'

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Tenant =>
    ctx.switchToHttp().getRequest().tenant,
)
```

Create `server/src/tenant/tenant.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { TenantService } from './tenant.service'

@Module({
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
```

Wire the middleware in `server/src/app.module.ts` (add imports and the `configure` method):

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { HealthController } from './health/health.controller'
import { PrismaModule } from './prisma/prisma.module'
import { TenantModule } from './tenant/tenant.module'
import { TenantMiddleware } from './tenant/tenant.middleware'

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, TenantModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).exclude('health').forRoutes('*path')
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm --prefix server test` → Expected: all suites PASS.
Run: `npm --prefix server run build` → Expected: compiles clean.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: Origin/Host tenant resolution middleware with default fallback"
```

---

### Task 7: Tenant-scoped Prisma access (TDD, server)

**Files:**
- Create: `server/src/prisma/tenant-scope.ts`
- Test: `server/src/prisma/tenant-scope.spec.ts`
- Modify: `server/src/prisma/prisma.service.ts`

**Interfaces:**
- Consumes: `PrismaService`
- Produces:
  - `applyTenantScope(model: string, operation: string, args: Record<string, unknown> | undefined, tenantId: string): Record<string, unknown>` — pure
  - `PrismaService.forTenant(tenantId: string)` — memoized per-tenant extended client; the ONLY sanctioned handle for business queries. Exempt models (parent- or globally-scoped): `Tenant`, `BundleItem`, `OrderItem`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/prisma/tenant-scope.spec.ts`:

```ts
import { applyTenantScope } from './tenant-scope'

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
      {
        where: { tenantId_authId: { tenantId: TID, authId: 'a1' } },
        create: { authId: 'a1' },
        update: { name: 'N' },
      },
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

Run: `npm --prefix server test` → Expected: FAIL — cannot find `./tenant-scope`.

- [ ] **Step 3: Implement**

Create `server/src/prisma/tenant-scope.ts`:

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

In `server/src/prisma/prisma.service.ts`, add the memoized extension (full updated file):

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { applyTenantScope } from './tenant-scope'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private tenantClients = new Map<string, ReturnType<PrismaService['buildTenantClient']>>()

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }

  private buildTenantClient(tenantId: string) {
    return this.$extends({
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

  forTenant(tenantId: string) {
    let client = this.tenantClients.get(tenantId)
    if (!client) {
      client = this.buildTenantClient(tenantId)
      this.tenantClients.set(tenantId, client)
    }
    return client
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm --prefix server test` → Expected: all suites PASS.
Run: `npm --prefix server run build` → Expected: clean.

- [ ] **Step 5: Commit**

```powershell
git add server/src/prisma
git commit -m "feat: tenant-scoped Prisma access via memoized client extension"
```

---

### Task 8: Seed script (server)

**Files:**
- Create: `server/prisma/seed.ts`
- Modify: `server/package.json` (prisma seed hook)

**Interfaces:**
- Consumes: schema from Task 4, real DB from Task 0
- Produces: idempotent seed — `default` tenant (domains `["localhost"]`, `isDefault: true`, `paymentMode: MANUAL_UPI`) + 4 NOTE products with aliases + 1 BUNDLE. Later manual testing depends on this data.

- [ ] **Step 1: Write the seed**

Create `server/prisma/seed.ts`:

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

Add to `server/package.json` (top level):

```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

- [ ] **Step 2: Run twice (idempotency)**

Run: `cd server; npx prisma db seed; cd ..` → Expected: `Seeded tenant "default" with 4 notes + 1 bundle`. Run again → same output, no unique-constraint errors.

- [ ] **Step 3: Verify**

Run: `cd server; npx prisma studio; cd ..` → `Product` has 5 rows, aliases attached. Close studio.

- [ ] **Step 4: Commit**

```powershell
git add server/prisma/seed.ts server/package.json
git commit -m "feat: idempotent seed with default tenant and sample catalog"
```

---

### Task 9: Auth — Supabase JWT guard + user sync (server) and Google sign-in (client)

**Files:**
- Create (server): `server/src/auth/auth-user.ts`, `server/src/auth/supabase-auth.guard.ts`, `server/src/auth/current-user.decorator.ts`, `server/src/users/users.service.ts`, `server/src/users/users.module.ts`, `server/src/auth/auth.controller.ts`, `server/src/auth/auth.module.ts`
- Test (server): `server/src/auth/auth-user.spec.ts`
- Create (client): `client/lib/supabase.ts`, `client/lib/api.ts`, `client/components/auth-buttons.tsx`, `client/app/auth/callback/page.tsx`, `client/app/auth/error/page.tsx`
- Modify: `server/src/app.module.ts`

**Interfaces:**
- Consumes: `SUPABASE_URL` (server env), `PrismaService.forTenant`, `@CurrentTenant()`
- Produces:
  - `mapAuthUser(authUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }): { email: string; name: string | null }` — pure, throws on missing email
  - `payloadToAuthUser(payload: Record<string, unknown>)` — pure JWT-claims mapper
  - `SupabaseAuthGuard` — verifies bearer token against Supabase JWKS, sets `req.authUser`
  - `@CurrentUser()` decorator → `req.authUser`
  - `UsersService.ensureUserRecord(tenantId, authUser): Promise<User>` — upsert by `(tenantId, authId)`
  - `POST /auth/sync` (guarded) → upserts and returns the app user; the client calls it right after sign-in
  - Client: `apiFetch(path, init?)` attaching `Authorization: Bearer <token>` when a session exists; `SignInButton`/`SignOutButton`; `/auth/callback` completes PKCE then syncs.

- [ ] **Step 1: Server — failing tests for the pure mappers**

```powershell
npm --prefix server install jose
```

Create `server/src/auth/auth-user.spec.ts`:

```ts
import { mapAuthUser, payloadToAuthUser } from './auth-user'

describe('mapAuthUser', () => {
  it('extracts email and full name from metadata', () => {
    expect(
      mapAuthUser({ id: 'u1', email: 'kid@gmail.com', user_metadata: { full_name: 'Kid Kumar' } }),
    ).toEqual({ email: 'kid@gmail.com', name: 'Kid Kumar' })
  })

  it('falls back to name, then null', () => {
    expect(mapAuthUser({ id: 'u1', email: 'a@b.com', user_metadata: { name: 'A' } }).name).toBe('A')
    expect(mapAuthUser({ id: 'u1', email: 'a@b.com' }).name).toBeNull()
  })

  it('lowercases the email', () => {
    expect(mapAuthUser({ id: 'u1', email: 'Kid@Gmail.COM' }).email).toBe('kid@gmail.com')
  })

  it('throws when the auth user has no email', () => {
    expect(() => mapAuthUser({ id: 'u1' })).toThrow(/email/i)
  })
})

describe('payloadToAuthUser', () => {
  it('maps sub/email/user_metadata claims', () => {
    expect(
      payloadToAuthUser({ sub: 'uuid-1', email: 'a@b.com', user_metadata: { full_name: 'A B' } }),
    ).toEqual({ id: 'uuid-1', email: 'a@b.com', user_metadata: { full_name: 'A B' } })
  })

  it('throws when sub is missing', () => {
    expect(() => payloadToAuthUser({ email: 'a@b.com' })).toThrow(/sub/i)
  })
})
```

Run: `npm --prefix server test` → Expected: FAIL — cannot find `./auth-user`.

- [ ] **Step 2: Server — implement auth**

Create `server/src/auth/auth-user.ts`:

```ts
export type AuthUserLike = {
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

export function payloadToAuthUser(payload: Record<string, unknown>): AuthUserLike {
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('JWT payload has no sub claim')
  }
  return {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    user_metadata:
      payload.user_metadata && typeof payload.user_metadata === 'object'
        ? (payload.user_metadata as Record<string, unknown>)
        : undefined,
  }
}
```

Create `server/src/auth/supabase-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Request } from 'express'
import { payloadToAuthUser } from './auth-user'

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>

  private getJwks() {
    if (!this.jwks) {
      const base = process.env.SUPABASE_URL
      if (!base) throw new Error('SUPABASE_URL is not set')
      this.jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`))
    }
    return this.jwks
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { authUser?: unknown }>()
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) throw new UnauthorizedException('Missing bearer token')
    try {
      const { payload } = await jwtVerify(token, this.getJwks())
      req.authUser = payloadToAuthUser(payload as Record<string, unknown>)
      return true
    } catch {
      throw new UnauthorizedException('Invalid or expired token')
    }
  }
}
```

Create `server/src/auth/current-user.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AuthUserLike } from './auth-user'

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserLike =>
    ctx.switchToHttp().getRequest().authUser,
)
```

Create `server/src/users/users.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import type { User } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuthUserLike, mapAuthUser } from '../auth/auth-user'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureUserRecord(tenantId: string, authUser: AuthUserLike): Promise<User> {
    const { email, name } = mapAuthUser(authUser)
    const db = this.prisma.forTenant(tenantId)
    return db.user.upsert({
      where: { tenantId_authId: { tenantId, authId: authUser.id } },
      create: { authId: authUser.id, email, name },
      update: { email, name },
    }) as Promise<User>
  }
}
```

Create `server/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { UsersService } from './users.service'

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Create `server/src/auth/auth.controller.ts`:

```ts
import { Controller, Post, UseGuards } from '@nestjs/common'
import type { Tenant } from '@prisma/client'
import { CurrentTenant } from '../tenant/current-tenant.decorator'
import { UsersService } from '../users/users.service'
import { SupabaseAuthGuard } from './supabase-auth.guard'
import { CurrentUser } from './current-user.decorator'
import type { AuthUserLike } from './auth-user'

@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  @Post('sync')
  @UseGuards(SupabaseAuthGuard)
  async sync(@CurrentTenant() tenant: Tenant, @CurrentUser() authUser: AuthUserLike) {
    const user = await this.users.ensureUserRecord(tenant.id, authUser)
    return { id: user.id, email: user.email, name: user.name, role: user.role }
  }
}
```

Create `server/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { AuthController } from './auth.controller'

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
})
export class AuthModule {}
```

Add `UsersModule, AuthModule` to `AppModule` imports.

Run: `npm --prefix server test` → Expected: PASS. `npm --prefix server run build` → clean.

- [ ] **Step 3: Client — Supabase sign-in + API helper**

```powershell
npm --prefix client install @supabase/supabase-js
```

Create `client/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)
```

Create `client/lib/api.ts`:

```ts
import { supabase } from './supabase'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`)
  return (await res.json()) as T
}
```

Create `client/components/auth-buttons.tsx`:

```tsx
'use client'

import { supabase } from '@/lib/supabase'

export function SignInButton() {
  const signIn = async () => {
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

Create `client/app/auth/callback/page.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { apiFetch } from '@/lib/api'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) return router.replace('/auth/error')
      }
      const { data } = await supabase.auth.getSession()
      if (!data.session) return router.replace('/auth/error')
      try {
        await apiFetch('/auth/sync', { method: 'POST' })
      } catch {
        return router.replace('/auth/error')
      }
      router.replace('/')
    }
    void run()
  }, [router])

  return <main className="p-8 text-center text-sm text-gray-600">Signing you in…</main>
}
```

Create `client/app/auth/error/page.tsx`:

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

Run: `npm --prefix client test` → Expected: still green (no client unit tests added here; callback is exercised in Task 10's end-to-end check).

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "feat: Supabase JWT auth guard, user sync endpoint, Google sign-in flow"
```

---

### Task 10: Tenant config endpoint, branded layout, end-to-end verification

**Files:**
- Create (server): `server/src/tenant/tenant.controller.ts`
- Create (client): `client/lib/branding.ts`, `client/lib/tenant-config.ts`, `client/components/site-header.tsx`
- Test: `client/tests/branding.test.ts`
- Modify: `server/src/tenant/tenant.module.ts`, `client/app/layout.tsx`, `client/app/page.tsx`

**Interfaces:**
- Consumes: `@CurrentTenant()`, `apiFetch`, auth buttons (Task 9)
- Produces:
  - `GET /tenant/config` (public) → `{ slug: string; name: string; branding: unknown }`
  - `brandingToCssVars(branding: unknown): Record<string, string>` — pure, safe defaults
  - `getTenantConfig(): Promise<TenantConfig>` — server-side fetch, 60s revalidate, hard fallback so a down API never breaks the client build
  - Branded layout + header with live auth state. Phase 2 pages render inside this shell.

- [ ] **Step 1: Client — failing branding test**

Create `client/tests/branding.test.ts`:

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

Run: `npm --prefix client test` → Expected: FAIL — cannot resolve `@/lib/branding`.

- [ ] **Step 2: Implement server endpoint and client shell**

Create `server/src/tenant/tenant.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common'
import type { Tenant } from '@prisma/client'
import { CurrentTenant } from './current-tenant.decorator'

@Controller('tenant')
export class TenantController {
  @Get('config')
  config(@CurrentTenant() tenant: Tenant) {
    return { slug: tenant.slug, name: tenant.name, branding: tenant.branding }
  }
}
```

Register it in `server/src/tenant/tenant.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { TenantService } from './tenant.service'
import { TenantController } from './tenant.controller'

@Module({
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
```

Create `client/lib/branding.ts`:

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

Create `client/lib/tenant-config.ts`:

```ts
export type TenantConfig = { slug: string; name: string; branding: unknown }

const FALLBACK: TenantConfig = { slug: 'default', name: 'Notes Platform', branding: {} }

export async function getTenantConfig(): Promise<TenantConfig> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${base}/tenant/config`, { next: { revalidate: 60 } })
    if (!res.ok) return FALLBACK
    return (await res.json()) as TenantConfig
  } catch {
    return FALLBACK
  }
}
```

Create `client/components/site-header.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { SignInButton, SignOutButton } from '@/components/auth-buttons'

export function SiteHeader({ tenantName }: { tenantName: string }) {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      setEmail(session?.user.email ?? null),
    )
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
        <Link href="/" className="text-lg font-bold" style={{ color: 'var(--brand-primary)' }}>
          {tenantName}
        </Link>
        <nav className="flex items-center gap-3">
          {email ? (
            <>
              <span className="text-sm text-gray-600">{email}</span>
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

Replace `client/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import './globals.css'
import { getTenantConfig } from '@/lib/tenant-config'
import { brandingToCssVars } from '@/lib/branding'
import { SiteHeader } from '@/components/site-header'

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantConfig()
  return {
    title: { default: tenant.name, template: `%s | ${tenant.name}` },
    description: `Handwritten notes by ${tenant.name}`,
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenantConfig()
  return (
    <html lang="en" style={brandingToCssVars(tenant.branding)}>
      <body className="min-h-screen antialiased">
        <SiteHeader tenantName={tenant.name} />
        {children}
      </body>
    </html>
  )
}
```

Replace `client/app/page.tsx`:

```tsx
import { getTenantConfig } from '@/lib/tenant-config'

export default async function HomePage() {
  const tenant = await getTenantConfig()
  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-3xl font-bold">Handwritten notes that make Class 9 &amp; 10 easy</h1>
      <p className="mt-2 text-gray-600">{tenant.name} — full storefront lands in Phase 2.</p>
    </main>
  )
}
```

(Note: the Task 1 scaffold used Next 16 defaults — if `layout.tsx` imports fonts or other boilerplate you removed, keep the diff minimal but ensure the file compiles. Check `client/node_modules/next/dist/docs/` if any App Router convention looks unfamiliar.)

- [ ] **Step 3: Run tests**

Run: `npm --prefix client test` → Expected: branding + smoke PASS.
Run: `npm --prefix server test` → Expected: all suites PASS.

- [ ] **Step 4: End-to-end verification** (requires Task 0 done, DB migrated + seeded)

Run from repo root: `npm run dev` (starts web :3000 + api :3001). Then:
1. `http://localhost:3001/health` → `{"ok":true}`.
2. `http://localhost:3001/tenant/config` → 404 is EXPECTED from a browser address bar only if no default tenant is seeded; with the seed in place expect `{"slug":"default","name":"Topper Notes Institute",...}`.
3. `http://localhost:3000` → header shows **Topper Notes Institute** in brand blue; "Sign in with Google" visible.
4. Complete Google sign-in → redirected home; header shows your email.
5. `cd server; npx prisma studio` → `User` table has one row, `role = STUDENT`, correct `tenantId`.

- [ ] **Step 5: Commit — Phase 1 complete**

```powershell
git add -A
git commit -m "feat: tenant config endpoint and branded storefront shell with auth state"
```

---

## Phase 1 exit criteria

- `npm --prefix server test` green (health, crypto, tenant resolver, tenant middleware, tenant scope, auth mappers).
- `npm --prefix client test` green (smoke, branding).
- `npm --prefix server run build` and `npm --prefix client run build` clean.
- `GET /health` and `GET /tenant/config` return live data; storefront renders seeded tenant branding.
- Google sign-in → `POST /auth/sync` → tenant-scoped `User` row.
- Schema migrated including `pg_trgm` (verify in Supabase SQL editor: `SELECT * FROM pg_extension WHERE extname = 'pg_trgm';`).

**Next:** write the Phase 2 plan (catalog CRUD, Drive client, preview generation, PLP/PDP, academic search) against this split layout.
