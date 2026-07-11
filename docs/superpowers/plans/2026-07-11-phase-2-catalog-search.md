# Phase 2: Catalog & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working catalog: admins create note/bundle products bound to Google Drive files with auto-generated watermarked previews; students browse a filterable listing, open product pages, and find chapters through typo-tolerant academic search — all tenant-scoped.

**Architecture:** Everything business-side lands in `server/` (NestJS 11): the outbox worker (`@nestjs/schedule`), a Drive service-account client, a `StorageProvider` (local disk in dev), the preview pipeline (pdfjs → canvas → sharp watermark), admin CRUD behind a role guard, public catalog endpoints, and raw-SQL trigram search (manually tenant-scoped). `client/` (Next.js 16) adds the PLP, PDP, search UI, and a minimal `/admin` area. SSR tenant resolution is fixed via an `X-Tenant-Host` header forwarded by a new server-fetch helper.

**Tech Stack additions:** `googleapis`, `pdfjs-dist` + `@napi-rs/canvas`, `sharp`, `@nestjs/schedule`, `class-validator` + `class-transformer` (DTO validation), `pdf-lib` (dev-only, test fixture generation).

## Global Constraints

- Everything from Phase 1 stands: TS strict both apps; Prettier both apps; server Jest colocated `src/**/*.spec.ts`, client Vitest `client/tests/`; money in integer paise; client env = `NEXT_PUBLIC_API_URL` only; server-only secrets.
- **Commit policy: agents NEVER commit or `git add`. The user commits personally.** Read-only git commands only.
- All business queries via `PrismaService.forTenant(tenantId)`. The ONLY sanctioned raw-SQL exception is `SearchService` (Task 9), which must include `p."tenantId" = ${tenantId}` in every statement and carries a dedicated isolation test.
- Public catalog endpoints return only `status = 'ACTIVE'` products. Admin endpoints require role `ADMIN` (JWT claim) on top of tenant resolution.
- Preview/cover images are LOW-RES (max width 900px, JPEG quality 70) and watermarked — never store or serve unwatermarked page renders.
- Every new env var lands in `server/.env.example` in the same change. New server env this phase: `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY_B64`, `MEDIA_DIR` (default `./media`), `PUBLIC_MEDIA_BASE` (default `http://localhost:3001/media`).
- `server/media/` is gitignored (generated content).
- Windows dev machine: PowerShell commands, plain `npm`/`npx`. Next.js 16: check `client/node_modules/next/dist/docs/` when an App Router convention looks unfamiliar.
- Admin promotion in MVP is a manual DB flip (`npx prisma studio` → User.role = ADMIN). Documented, deliberate — self-serve admin management is Phase 4.

---

### Task 0: Manual prerequisites (human, one-time)

No code. Values go into `server/.env`.

- [ ] **Step 1:** In the existing Google Cloud project, enable the **Google Drive API** (APIs & Services → Enable). Create a **Service Account** (IAM & Admin → Service Accounts → Create; no project roles needed). Open it → Keys → Add key → JSON. Download the key file.
- [ ] **Step 2:** From the JSON key, put `client_email` into `server/.env` as `GOOGLE_SA_CLIENT_EMAIL`. Base64-encode the `private_key` value (the whole `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` string) and put it in `GOOGLE_SA_PRIVATE_KEY_B64`. PowerShell one-liner (replace the path):
  `$k = (Get-Content path\to\key.json | ConvertFrom-Json).private_key; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($k))`
- [ ] **Step 3:** In Google Drive (any account — for testing, your own), create a folder `notes-platform-test`, upload 1–2 real handwritten-note PDFs (5+ pages ideally), and **share the folder with the service-account email as Editor**. Note the folder ID (URL segment after `/folders/`) and one PDF's file ID (URL segment after `/file/d/`). Keep them handy for admin testing.
- [ ] **Step 4:** In Prisma Studio (`cd server; npx prisma studio`), set the default tenant's `driveRootFolderId` to the folder ID, and flip your own `User.role` to `ADMIN`.

---

### Task 1: SSR tenant host-forwarding (X-Tenant-Host)

**Files:**
- Modify: `server/src/tenant/tenant.middleware.ts`, `server/src/tenant/tenant.middleware.spec.ts`
- Create: `client/lib/api-server.ts`
- Modify: `client/lib/tenant-config.ts`

**Interfaces:**
- Consumes: existing `TenantService.resolveByHost`
- Produces: middleware host priority `X-Tenant-Host → Origin → Host`; `apiServerFetch<T>(path)` — server-component fetch helper that forwards the browser's Host and uses `cache: 'no-store'`. All later SSR data fetching (PLP/PDP) uses `apiServerFetch`.

- [ ] **Step 1: Failing middleware tests**

Add to `server/src/tenant/tenant.middleware.spec.ts` (inside the existing describe, reusing its `middlewareWith` helper):

```ts
  it('prefers X-Tenant-Host over Origin and Host', async () => {
    const { mw, service } = middlewareWith(tenant);
    const req: Record<string, unknown> = {
      headers: {
        'x-tenant-host': 'sharmanotes.in',
        origin: 'http://localhost:3001',
        host: 'api.internal:3001',
      },
    };
    await mw.use(req as never, {} as never, jest.fn());
    expect(service.resolveByHost).toHaveBeenCalledWith('sharmanotes.in');
  });

  it('ignores a non-string X-Tenant-Host', async () => {
    const { mw, service } = middlewareWith(tenant);
    const req: Record<string, unknown> = {
      headers: { 'x-tenant-host': ['a.com', 'b.com'], host: 'localhost:3001' },
    };
    await mw.use(req as never, {} as never, jest.fn());
    expect(service.resolveByHost).toHaveBeenCalledWith('localhost:3001');
  });
```

Run: `npm --prefix server test` → Expected: FAIL (middleware ignores the header today).

- [ ] **Step 2: Implement**

In `server/src/tenant/tenant.middleware.ts`, replace the host derivation at the top of `use()`:

```ts
    const forwarded = req.headers['x-tenant-host'];
    let host: string | null =
      typeof forwarded === 'string' && forwarded.length > 0 ? forwarded : null;
    if (!host) {
      const origin = req.headers.origin;
      if (typeof origin === 'string') {
        try {
          host = new URL(origin).host;
        } catch {
          host = null;
        }
      }
    }
    host = host ?? req.headers.host ?? null;
```

Run: `npm --prefix server test` → PASS.

- [ ] **Step 3: Client server-fetch helper**

Create `client/lib/api-server.ts`:

```ts
import 'server-only';
import { headers } from 'next/headers';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Fetch from the API inside Server Components, forwarding the browser's Host
 * so the API resolves the right tenant. cache: 'no-store' is deliberate —
 * Next's data cache does not key on request headers, so caching here would
 * serve tenant A's data on tenant B's domain.
 */
export async function apiServerFetch<T>(path: string): Promise<T> {
  const h = await headers();
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    headers: { 'X-Tenant-Host': h.get('host') ?? '' },
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return (await res.json()) as T;
}
```

Install the guard package if the client lacks it: `npm --prefix client install server-only`.

Rewrite `client/lib/tenant-config.ts` to use it (keep the fallback):

```ts
import { apiServerFetch } from './api-server';

export type TenantConfig = { slug: string; name: string; branding: unknown };

const FALLBACK: TenantConfig = { slug: 'default', name: 'Notes Platform', branding: {} };

export async function getTenantConfig(): Promise<TenantConfig> {
  try {
    return await apiServerFetch<TenantConfig>('/tenant/config');
  } catch {
    return FALLBACK;
  }
}
```

- [ ] **Step 4: Verify**

`npm --prefix client test` green; `npm --prefix client run build` clean; `npm --prefix server test` green. Boot both (`npm run dev`), open `http://localhost:3000` → header still shows the seeded tenant (now resolved via the forwarded host). Stop servers.

---

### Task 2: Outbox worker (@nestjs/schedule)

**Files:**
- Create: `server/src/jobs/job-math.ts`, `server/src/jobs/job-math.spec.ts`, `server/src/jobs/jobs.service.ts`, `server/src/jobs/job-handler.ts`, `server/src/jobs/jobs.worker.ts`, `server/src/jobs/jobs.module.ts`
- Modify: `server/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (job claiming intentionally spans tenants — the worker is platform infrastructure; handlers receive `tenantId` from the job row)
- Produces:
  - `computeBackoffMs(attempts: number): number` — `min(30_000 * 2^attempts, 3_600_000)`
  - `JobHandler` interface: `{ type: JobType; handle(job: FulfillmentJob): Promise<void> }` — Task 5 registers the first one
  - `JobsService.enqueue(tenantId: string, type: JobType, payload: object): Promise<FulfillmentJob>`
  - `JobsService.processDueJobs(limit?: number): Promise<number>` — claims and runs due jobs; returns count processed
  - `JobsWorker` — cron every 30s calling `processDueJobs(5)`

- [ ] **Step 1: TDD the pure math**

Create `server/src/jobs/job-math.spec.ts`:

```ts
import { computeBackoffMs, isDead } from './job-math';

describe('job math', () => {
  it('doubles backoff per attempt from a 30s base', () => {
    expect(computeBackoffMs(0)).toBe(30_000);
    expect(computeBackoffMs(1)).toBe(60_000);
    expect(computeBackoffMs(3)).toBe(240_000);
  });

  it('caps backoff at one hour', () => {
    expect(computeBackoffMs(20)).toBe(3_600_000);
  });

  it('declares a job dead once attempts reach maxAttempts', () => {
    expect(isDead(4, 5)).toBe(false);
    expect(isDead(5, 5)).toBe(true);
    expect(isDead(6, 5)).toBe(true);
  });
});
```

Run → FAIL. Create `server/src/jobs/job-math.ts`:

```ts
const BASE_MS = 30_000;
const CAP_MS = 3_600_000;

export function computeBackoffMs(attempts: number): number {
  return Math.min(BASE_MS * 2 ** attempts, CAP_MS);
}

export function isDead(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}
```

Run → PASS.

- [ ] **Step 2: Handler contract + service**

Create `server/src/jobs/job-handler.ts`:

```ts
import type { FulfillmentJob, JobType } from '@prisma/client';

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

export interface JobHandler {
  readonly type: JobType;
  handle(job: FulfillmentJob): Promise<void>;
}
```

Create `server/src/jobs/jobs.service.ts`:

```ts
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { FulfillmentJob, JobType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_HANDLERS, JobHandler } from './job-handler';
import { computeBackoffMs, isDead } from './job-math';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<JobType, JobHandler>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(JOB_HANDLERS) handlers: JobHandler[] = [],
  ) {
    for (const h of handlers) this.handlers.set(h.type, h);
  }

  async enqueue(tenantId: string, type: JobType, payload: object): Promise<FulfillmentJob> {
    return this.prisma.forTenant(tenantId).fulfillmentJob.create({
      data: { type, payload: payload as Prisma.InputJsonValue },
    }) as Promise<FulfillmentJob>;
  }

  /** Claims and runs due PENDING jobs. Worker infrastructure: spans tenants by design. */
  async processDueJobs(limit = 5): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const due = await this.prisma.fulfillmentJob.findFirst({
        where: { status: 'PENDING', nextRunAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
      });
      if (!due) break;
      const claimed = await this.prisma.fulfillmentJob.updateMany({
        where: { id: due.id, status: 'PENDING' },
        data: { status: 'RUNNING' },
      });
      if (claimed.count !== 1) continue; // raced; try next loop iteration
      await this.run({ ...due, status: 'RUNNING' });
      processed++;
    }
    return processed;
  }

  private async run(job: FulfillmentJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
      await handler.handle(job);
      await this.prisma.fulfillmentJob.update({
        where: { id: job.id },
        data: { status: 'DONE', lastError: null },
      });
    } catch (e) {
      const attempts = job.attempts + 1;
      const dead = isDead(attempts, job.maxAttempts);
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Job ${job.id} (${job.type}) failed attempt ${attempts}: ${message}`);
      await this.prisma.fulfillmentJob.update({
        where: { id: job.id },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          attempts,
          lastError: message,
          nextRunAt: new Date(Date.now() + computeBackoffMs(attempts)),
        },
      });
    }
  }
}
```

Note: `fulfillmentJob` is tenant-owned, so the scoper would demand `tenantId` — but the worker legitimately spans tenants. Add `'FulfillmentJob'` to the scoper's `EXEMPT_MODELS`? NO — instead the worker uses the RAW `prisma` client deliberately (as above), which never passes through `forTenant()`. Add one sentence to the exemption doc-comment in `server/src/prisma/tenant-scope.ts` naming `JobsService.processDueJobs/run` as a sanctioned raw-client consumer (enqueue stays tenant-scoped).

Create `server/src/jobs/jobs.worker.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobsService } from './jobs.service';

@Injectable()
export class JobsWorker {
  constructor(private readonly jobs: JobsService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    await this.jobs.processDueJobs(5);
  }
}
```

Create `server/src/jobs/jobs.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsWorker } from './jobs.worker';

@Module({
  providers: [JobsService, JobsWorker],
  exports: [JobsService],
})
export class JobsModule {}
```

Install + wire: `npm --prefix server install @nestjs/schedule`; in `AppModule` imports add `ScheduleModule.forRoot()` and `JobsModule`.

- [ ] **Step 3: Service tests (mocked prisma)**

Create `server/src/jobs/jobs.service.spec.ts` — verify with a mocked `PrismaService`: (a) a handled job goes to DONE; (b) a throwing handler re-schedules with attempts+1, PENDING, nextRunAt in the future, lastError set; (c) attempts reaching maxAttempts → DEAD; (d) unknown job type → failure path (not a crash); (e) a lost claim race (`updateMany` count 0) skips without running the handler. Build the mock as an object with `fulfillmentJob: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() }` and inject a fake handler array via the constructor. Assert on the `update` payloads (status transitions + backoff timing within tolerance).

Run: `npm --prefix server test` → all green. `npm --prefix server run build` clean.

- [ ] **Step 4: Verify boot**

Start the server; within ~30s the log stays quiet (no due jobs) and nothing crashes — cron registered. Stop it.

---

### Task 3: Google Drive service-account client

**Files:**
- Create: `server/src/drive/drive.service.ts`, `server/src/drive/drive.service.spec.ts`, `server/src/drive/drive.module.ts`
- Modify: `server/src/tenant/tenant.controller.ts` (admin verify endpoint lands in Task 6 — here only the service), `server/.env.example`

**Interfaces:**
- Consumes: `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY_B64` env
- Produces `DriveService`:
  - `getFileMeta(fileId): Promise<{ id: string; name: string; mimeType: string }>`
  - `verifyAccess(fileId): Promise<{ ok: true; name: string } >` — throws `NotFoundException`/`ForbiddenException` mapped from Drive 404/403
  - `downloadFile(fileId): Promise<Buffer>`
  - `setCopyProtection(fileId): Promise<void>` — sets `copyRequiresWriterPermission: true`
  - (Grants/revokes are Phase 3 — do NOT add them now.)

- [ ] **Step 1: Implement with an injectable Drive factory (testability)**

```powershell
npm --prefix server install googleapis
```

Create `server/src/drive/drive.service.ts`:

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';

function saKey(): string {
  const b64 = process.env.GOOGLE_SA_PRIVATE_KEY_B64;
  if (!b64) throw new Error('GOOGLE_SA_PRIVATE_KEY_B64 is not set');
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function buildDriveClient(): drive_v3.Drive {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SA_CLIENT_EMAIL,
    key: saKey(),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

type DriveError = { code?: number; response?: { status?: number } };

function statusOf(e: unknown): number | undefined {
  const err = e as DriveError;
  return err.response?.status ?? err.code;
}

@Injectable()
export class DriveService {
  // Lazily built so the app boots without SA credentials (calls fail, boot doesn't).
  private client?: drive_v3.Drive;

  constructor(private readonly factory: () => drive_v3.Drive = buildDriveClient) {}

  private drive(): drive_v3.Drive {
    if (!this.client) this.client = this.factory();
    return this.client;
  }

  private mapError(e: unknown, fileId: string): never {
    const status = statusOf(e);
    if (status === 404) throw new NotFoundException(`Drive file ${fileId} not found or not shared with the platform service account`);
    if (status === 403) throw new ForbiddenException(`Platform service account lacks access to Drive file ${fileId}`);
    throw e as Error;
  }

  async getFileMeta(fileId: string): Promise<{ id: string; name: string; mimeType: string }> {
    try {
      const res = await this.drive().files.get({
        fileId,
        fields: 'id,name,mimeType',
        supportsAllDrives: true,
      });
      return { id: res.data.id ?? fileId, name: res.data.name ?? '', mimeType: res.data.mimeType ?? '' };
    } catch (e) {
      this.mapError(e, fileId);
    }
  }

  async verifyAccess(fileId: string): Promise<{ ok: true; name: string }> {
    const meta = await this.getFileMeta(fileId);
    return { ok: true, name: meta.name };
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    try {
      const res = await this.drive().files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );
      return Buffer.from(res.data as ArrayBuffer);
    } catch (e) {
      this.mapError(e, fileId);
    }
  }

  async setCopyProtection(fileId: string): Promise<void> {
    try {
      await this.drive().files.update({
        fileId,
        requestBody: { copyRequiresWriterPermission: true },
        supportsAllDrives: true,
      });
    } catch (e) {
      this.mapError(e, fileId);
    }
  }
}
```

Create `server/src/drive/drive.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DriveService } from './drive.service';

@Module({
  providers: [DriveService],
  exports: [DriveService],
})
export class DriveModule {}
```

Add `DriveModule` to `AppModule` imports. Append to `server/.env.example`:

```bash
# Google Drive platform service account (Phase 2)
GOOGLE_SA_CLIENT_EMAIL="<service-account>@<project>.iam.gserviceaccount.com"
GOOGLE_SA_PRIVATE_KEY_B64="<base64 of the JSON key's private_key field>"
```

- [ ] **Step 2: Tests (mocked drive client)**

Create `server/src/drive/drive.service.spec.ts` — construct `new DriveService(() => mockDrive as never)` where `mockDrive = { files: { get: jest.fn(), update: jest.fn() } }`. Cases: (a) `getFileMeta` maps fields; (b) 404 from the API → `NotFoundException` with the file id in the message; (c) 403 → `ForbiddenException`; (d) `downloadFile` returns a Buffer from an arraybuffer response; (e) `setCopyProtection` calls `files.update` with `copyRequiresWriterPermission: true` and `supportsAllDrives: true`; (f) unknown errors re-throw untouched.

Run: `npm --prefix server test` → green. Build + lint clean.

- [ ] **Step 3: Live smoke (needs Task 0)**

Temporary script (do not commit — delete after): `cd server; npx tsx -e "import('./src/drive/drive.service').then(async m => { const s = new m.DriveService(); console.log(await s.verifyAccess('<TEST_FILE_ID_from_Task_0>')); })"` → expect `{ ok: true, name: '<your pdf name>' }`. If Task 0 isn't done yet, note it in the report and skip — unit tests carry the task.

---

### Task 4: StorageProvider (local disk) + /media static serving

**Files:**
- Create: `server/src/storage/storage.provider.ts`, `server/src/storage/local-disk.storage.ts`, `server/src/storage/local-disk.storage.spec.ts`, `server/src/storage/storage.module.ts`
- Modify: `server/src/main.ts`, root `.gitignore`, `server/.env.example`

**Interfaces:**
- Produces:
  - `STORAGE_PROVIDER` injection token; interface `StorageProvider { save(relPath: string, data: Buffer): Promise<void>; publicUrl(relPath: string): string; remove(relPath: string): Promise<void> }`
  - `LocalDiskStorage` — writes under `MEDIA_DIR` (default `<server cwd>/media`), URL = `PUBLIC_MEDIA_BASE + '/' + relPath`
  - Static serving of `MEDIA_DIR` at `/media` (Express static, no auth — previews are public marketing assets)
- Pre-launch swap to a Supabase Storage adapter is a Phase 4 checklist item; consumers depend only on the interface.

- [ ] **Step 1: TDD LocalDiskStorage**

Spec cases (use a temp dir via `fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'))` injected as `MEDIA_DIR` through the constructor): (a) `save` creates nested directories and writes bytes (read back and compare); (b) `publicUrl('a/b.jpg')` = `${base}/a/b.jpg`; (c) `remove` deletes and is idempotent (no throw when missing); (d) `save` rejects path traversal — a relPath containing `..` throws before touching disk. RED → implement → GREEN.

`server/src/storage/local-disk.storage.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { StorageProvider } from './storage.provider';

@Injectable()
export class LocalDiskStorage implements StorageProvider {
  constructor(
    private readonly rootDir: string = process.env.MEDIA_DIR ?? path.join(process.cwd(), 'media'),
    private readonly baseUrl: string = process.env.PUBLIC_MEDIA_BASE ?? 'http://localhost:3001/media',
  ) {}

  private resolveSafe(relPath: string): string {
    const full = path.resolve(this.rootDir, relPath);
    if (!full.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`Unsafe media path: ${relPath}`);
    }
    return full;
  }

  async save(relPath: string, data: Buffer): Promise<void> {
    const full = this.resolveSafe(relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  publicUrl(relPath: string): string {
    return `${this.baseUrl}/${relPath.replaceAll('\\', '/')}`;
  }

  async remove(relPath: string): Promise<void> {
    await rm(this.resolveSafe(relPath), { force: true });
  }
}
```

`server/src/storage/storage.provider.ts`:

```ts
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  save(relPath: string, data: Buffer): Promise<void>;
  publicUrl(relPath: string): string;
  remove(relPath: string): Promise<void>;
}
```

`server/src/storage/storage.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { LocalDiskStorage } from './local-disk.storage';
import { STORAGE_PROVIDER } from './storage.provider';

@Global()
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: LocalDiskStorage }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
```

- [ ] **Step 2: Static serving + wiring**

In `server/src/main.ts` (NestExpressApplication):

```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'node:path';
// in bootstrap():
const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.useStaticAssets(process.env.MEDIA_DIR ?? path.join(process.cwd(), 'media'), { prefix: '/media/' });
```

Add `StorageModule` to `AppModule`. Root `.gitignore`: add `server/media/`. `server/.env.example`: add `MEDIA_DIR="./media"` and `PUBLIC_MEDIA_BASE="http://localhost:3001/media"` (commented as dev defaults).

Also exclude `media` from TenantMiddleware? Not needed — `useStaticAssets` serves before Nest routing, middleware never sees it. Verify in Step 3.

- [ ] **Step 3: Verify**

Suite green, build clean. Boot server; drop a test file `server/media/ping.txt` manually; `GET http://localhost:3001/media/ping.txt` → 200 with content (no tenant 404 — static bypasses middleware). Delete the test file. Stop server.

---

### Task 5: Preview generation pipeline (PREVIEW_GENERATION job)

**Files:**
- Create: `server/src/previews/pdf-render.ts`, `server/src/previews/pdf-render.spec.ts`, `server/src/previews/watermark.ts`, `server/src/previews/watermark.spec.ts`, `server/src/previews/preview.service.ts`, `server/src/previews/preview.service.spec.ts`, `server/src/previews/preview.handler.ts`, `server/src/previews/previews.module.ts`

**Interfaces:**
- Consumes: `DriveService.downloadFile`, `STORAGE_PROVIDER`, `PrismaService.forTenant`, `JobsService` handler registration (`JOB_HANDLERS` multi-provider)
- Produces:
  - `renderPdfPages(pdf: Buffer, pages: number[]): Promise<Buffer[]>` — PNG per requested page (1-indexed, silently clamps to page count, dedupes)
  - `applyWatermark(png: Buffer, text: string): Promise<Buffer>` — diagonal repeated text, resize to max width 900, JPEG q70
  - `PreviewService.generateForProduct(tenantId, productId)` — download → render (product.previewPages or [1,2,3]) → watermark with tenant name → save `tenants/<tenantId>/products/<productId>/preview-<n>.jpg` → update product `previewPaths` (+ `coverPath` = first) via `forTenant`
  - `PreviewGenerationHandler` (JobHandler, `type: 'PREVIEW_GENERATION'`, payload `{ productId: string }`) registered via `{ provide: JOB_HANDLERS, useFactory: (h) => [h], inject: [PreviewGenerationHandler] }` in `PreviewsModule` (module also imports Drive/Jobs modules; JobsService's `@Optional() @Inject(JOB_HANDLERS)` picks it up — wire `PreviewsModule` BEFORE JobsModule consumers or re-export; verify DI resolves at boot)

- [ ] **Step 1: Install rendering deps**

```powershell
npm --prefix server install pdfjs-dist @napi-rs/canvas sharp
npm --prefix server install -D pdf-lib
```

Note for the implementer: import pdfjs via its legacy Node build — `import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'` (ESM; if Jest chokes, extend the existing `transformIgnorePatterns` the way it was done for `jose`). Canvas comes from `@napi-rs/canvas` (`createCanvas`). If the pdfjs version requires a canvas factory, implement the minimal `NodeCanvasFactory` (create/reset/destroy) inline in `pdf-render.ts` — consult the pdfjs docs in `server/node_modules/pdfjs-dist/README.md` as needed.

- [ ] **Step 2: TDD `renderPdfPages`**

Spec (`pdf-render.spec.ts`): build a 4-page fixture PDF in-test with `pdf-lib` (each page 200x200 with distinct rect). Cases: (a) `renderPdfPages(pdf, [1,2])` → 2 PNG buffers (PNG magic bytes `89 50 4E 47`); (b) out-of-range page numbers are clamped/dropped — `[3, 99]` → 1 buffer for page 3... wait, both 3 and 99: 99 drops, 3 renders → exactly 1 buffer; (c) duplicates dedupe — `[1,1,2]` → 2 buffers; (d) non-PDF buffer → throws. RED → implement → GREEN.

- [ ] **Step 3: TDD `applyWatermark`**

Spec (`watermark.spec.ts`) using `sharp` to inspect output: (a) output is JPEG (magic bytes `FF D8`); (b) width ≤ 900 for a 2000px-wide input PNG (generate input with sharp: `sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#fff' } }).png()`); (c) output differs from a plain resize of the same input (watermark actually composited — compare buffers). Implementation: build an SVG overlay (tenant text repeated diagonally, `opacity="0.25"`, rotated -30°, tiled via `<pattern>`), `sharp(png).resize({ width: 900, withoutEnlargement: true }).composite([{ input: svgBuffer, tile: false }]).jpeg({ quality: 70 })`. Size the SVG to the resized image dimensions (`sharp.metadata()` after resize — two-pass: resize to buffer, then composite). RED → implement → GREEN.

- [ ] **Step 4: PreviewService + handler**

`preview.service.ts` (constructor: `DriveService`, `@Inject(STORAGE_PROVIDER) storage`, `PrismaService`):

```ts
async generateForProduct(tenantId: string, productId: string): Promise<void> {
  const db = this.prisma.forTenant(tenantId);
  const product = await db.product.findUnique({ where: { id: productId, tenantId } });
  if (!product) throw new Error(`Product ${productId} not found for tenant ${tenantId}`);
  if (!product.driveFileId) throw new Error(`Product ${productId} has no driveFileId`);
  const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
  const pdf = await this.drive.downloadFile(product.driveFileId);
  const pages = product.previewPages.length > 0 ? product.previewPages : [1, 2, 3];
  const pngs = await renderPdfPages(pdf, pages);
  if (pngs.length === 0) throw new Error(`No renderable pages for product ${productId}`);
  const paths: string[] = [];
  for (let i = 0; i < pngs.length; i++) {
    const jpeg = await applyWatermark(pngs[i], `${tenant?.name ?? 'PREVIEW'} • PREVIEW`);
    const rel = `tenants/${tenantId}/products/${productId}/preview-${i + 1}.jpg`;
    await this.storage.save(rel, jpeg);
    paths.push(rel);
  }
  await db.product.update({
    where: { id: productId, tenantId },
    data: { previewPaths: paths, coverPath: paths[0] },
  });
}
```

`preview.handler.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { FulfillmentJob } from '@prisma/client';
import { JobHandler } from '../jobs/job-handler';
import { PreviewService } from './preview.service';

@Injectable()
export class PreviewGenerationHandler implements JobHandler {
  readonly type = 'PREVIEW_GENERATION' as const;

  constructor(private readonly previews: PreviewService) {}

  async handle(job: FulfillmentJob): Promise<void> {
    const payload = job.payload as { productId?: string };
    if (!payload.productId) throw new Error('PREVIEW_GENERATION payload missing productId');
    await this.previews.generateForProduct(job.tenantId, payload.productId);
  }
}
```

`previews.module.ts` registers `PreviewService`, `PreviewGenerationHandler`, and provides `JOB_HANDLERS` as `useFactory: (h: PreviewGenerationHandler) => [h]`. Restructure `JobsModule`/`AppModule` wiring so `JobsService` receives the handlers (simplest correct: move the `JOB_HANDLERS` provider into `JobsModule` importing `PreviewsModule`, or make `PreviewsModule` export the token and have `JobsModule` import it — implementer verifies DI at boot; a boot log line listing registered handler types is worth adding to `JobsService`'s constructor).

`preview.service.spec.ts` (mocked drive/storage/prisma): (a) uses `[1,2,3]` when `previewPages` empty; (b) saves under the exact tenant/product path convention and updates `previewPaths`+`coverPath`; (c) missing `driveFileId` → throws (job will retry/dead-letter); (d) tenant name lands in the watermark call (spy on `applyWatermark`? it's a plain import — instead assert via storage.save called with JPEG buffers and accept watermark coverage from its own spec; document this boundary in the spec file).

Run full suite → green; build + lint clean.

---

### Task 6: Admin role guard + catalog CRUD API

**Files:**
- Create: `server/src/auth/roles.guard.ts`, `server/src/auth/roles.guard.spec.ts`, `server/src/auth/roles.decorator.ts`, `server/src/admin/admin-products.controller.ts`, `server/src/admin/dto/product.dto.ts`, `server/src/admin/admin.module.ts`, `server/src/admin/admin-products.controller.spec.ts`
- Modify: `server/src/main.ts` (global ValidationPipe), `server/src/app.module.ts`

**Interfaces:**
- Consumes: `JwtAuthGuard`, `@CurrentTenant()`, `@CurrentUserClaims()`, `PrismaService.forTenant`, `DriveService.verifyAccess`+`setCopyProtection`, `JobsService.enqueue`
- Produces (all under `/admin`, guarded by `JwtAuthGuard` + `RolesGuard` + `@Roles('ADMIN')`):
  - `GET /admin/products` (all statuses, with alias + bundleItem counts)
  - `POST /admin/products` (CreateProductDto), `PATCH /admin/products/:id` (UpdateProductDto), `DELETE /admin/products/:id` (409 if referenced by orders/entitlements — MVP: block, don't cascade)
  - `PUT /admin/products/:id/aliases` (replace full alias list)
  - `PUT /admin/products/:id/bundle-items` (bundle only: replace child note ids; 400 if any child is not a NOTE or is another tenant's)
  - `POST /admin/products/:id/verify-drive` → DriveService.verifyAccess + `setCopyProtection`, updates nothing on the product beyond returning `{ ok, name }`
  - `POST /admin/products/:id/generate-previews` → enqueues PREVIEW_GENERATION, returns job id
  - `POST /admin/tenant/verify-drive` → verifies tenant.driveRootFolderId, sets `driveStatus` VERIFIED/ERROR
- Global `ValidationPipe({ whitelist: true, transform: true })` — from this task on, every body is DTO-validated.

- [ ] **Step 1: Deps + ValidationPipe**

```powershell
npm --prefix server install class-validator class-transformer
```

In `main.ts`: `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));`

- [ ] **Step 2: TDD RolesGuard**

`roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

`roles.guard.spec.ts` cases: (a) no `@Roles` metadata → allows; (b) claims.role in required roles → allows; (c) role mismatch → `ForbiddenException`; (d) missing authClaims → `ForbiddenException` (defense in depth — JwtAuthGuard should have run first). Implement `roles.guard.ts` with `Reflector.getAllAndOverride(ROLES_KEY, [handler, class])` reading `req.authClaims.role`. RED → GREEN.

- [ ] **Step 3: DTOs**

`dto/product.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString,
  Matches, Max, MaxLength, Min,
} from 'class-validator';
import { ProductStatus, ProductType, Subject } from '@prisma/client';

export class CreateProductDto {
  @IsEnum(ProductType) type!: ProductType;
  @IsString() @MaxLength(120) @Matches(/^[a-z0-9-]+$/) slug!: string;
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsInt() @Min(9) @Max(10) classLevel!: number;
  @IsEnum(Subject) subject!: Subject;
  @IsOptional() @IsInt() @Min(1) @Max(30) chapterNo?: number;
  @IsInt() @Min(0) @Max(10_000_000) pricePaise!: number;
  @IsOptional() @IsString() @MaxLength(120) driveFileId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) @Type(() => Number) previewPages?: number[];
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
}

export class UpdateProductDto extends CreateProductDto {}
// PATCH semantics: make every field optional by overriding — simplest honest approach:
```

Correction for the implementer (apply this, not the naive extend): define `UpdateProductDto` with every property `@IsOptional()` (copy the fields; do NOT use `PartialType` from `@nestjs/mapped-types` unless you add that package — adding `@nestjs/mapped-types` IS acceptable and cleaner: `npm --prefix server install @nestjs/mapped-types` then `export class UpdateProductDto extends PartialType(CreateProductDto) {}`; choose the mapped-types route).

Also: `export class ReplaceAliasesDto { @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(80, { each: true }) aliases!: string[]; }` and `export class ReplaceBundleItemsDto { @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) noteIds!: string[]; }`

- [ ] **Step 4: Controller**

`admin-products.controller.ts` — `@Controller('admin')`, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles('ADMIN')` at class level. Every method takes `@CurrentTenant() tenant: Tenant` and uses `this.prisma.forTenant(tenant.id)`. Implement the seven endpoints listed in Interfaces. Notable logic:
- create: `db.product.create({ data: { ...dto, previewPages: dto.previewPages ?? [] } })`; map Prisma P2002 (unique slug) → `ConflictException`.
- delete: check `db.orderItem` — OrderItem is EXEMPT from scoping (parent-scoped), so count via `db.orderItem.count({ where: { productId: id, order: { tenantId: tenant.id } } })`... simpler and correct: `db.entitlement.count({ where: { productId: id } })` (tenant-scoped) plus `this.prisma.orderItem.count({ where: { productId: id } })` with a comment referencing the exemption; if either > 0 → `ConflictException('Product has purchase history; archive it instead')`. Also `db.productAlias.deleteMany({ where: { productId: id } })` and `this.prisma.bundleItem.deleteMany({ where: { OR: [{ bundleId: id }, { noteId: id }] } })` before `db.product.delete`.
- aliases replace: `deleteMany({ where: { productId: id } })` then `createMany` with tenantId (scoper stamps it).
- bundle-items replace: verify target is `type: 'BUNDLE'`; load all `noteIds` via `db.product.findMany({ where: { id: { in: noteIds }, type: 'NOTE' } })` (tenant-scoped — cross-tenant ids simply won't come back) and 400 unless every id resolved; then raw-client `bundleItem.deleteMany({ where: { bundleId: id } })` + `createMany` (BundleItem is exempt/parent-scoped — add a one-line comment).
- generate-previews: 400 if product has no `driveFileId`; enqueue and return `{ jobId }`.
- tenant verify-drive: read `tenant.driveRootFolderId` (400 if unset), `driveService.verifyAccess`, then update tenant row (`this.prisma.tenant.update` — Tenant is exempt from scoping) `driveStatus: 'VERIFIED'`; on caught NotFound/Forbidden set `driveStatus: 'ERROR'` and rethrow.

`admin.module.ts` imports `DriveModule`, `JobsModule`; controller registered; add to `AppModule`.

- [ ] **Step 5: Controller spec**

`admin-products.controller.spec.ts` with mocked prisma/drive/jobs: happy-path create, P2002 → Conflict, delete-blocked-by-history → Conflict, bundle-items rejects a non-resolving child id, verify-drive sets ERROR on ForbiddenException, generate-previews 400 without driveFileId. Run suite → green; build + lint clean.

- [ ] **Step 6: Live admin smoke (needs Task 0 step 4 — your user is ADMIN)**

Boot both apps. Using a REST client or PowerShell with your real JWT (grab from browser localStorage `notes_auth_token` after sign-in): create a product with the test Drive file id, `POST .../verify-drive` → `{ ok, name }`, `POST .../generate-previews`, wait ≤30s for the worker, then `GET http://localhost:3001/media/tenants/<tid>/products/<pid>/preview-1.jpg` → a watermarked page renders. Document each response in the report. Stop servers.

---

### Task 7: Admin UI (minimal)

**Files:**
- Create: `client/app/admin/layout.tsx`, `client/app/admin/page.tsx`, `client/app/admin/products/page.tsx`, `client/app/admin/products/new/page.tsx`, `client/app/admin/products/[id]/page.tsx`, `client/components/admin/product-form.tsx`, `client/lib/admin-api.ts`

**Interfaces:**
- Consumes: `apiFetch` (bearer token attaches automatically), Task 6 endpoints
- Produces: `/admin` — client-side-guarded shell (fetch `/auth/me`; role !== 'ADMIN' → replace to `/`); products table (title, type, class, subject, ₹, status, previews-present?); create/edit form incl. alias list (comma-separated input), bundle child-note picker (multi-select of NOTE products), Verify Drive + Generate Previews buttons with inline result/status display; delete with confirm.
- Server remains the enforcement point — the client guard is UX only (state this in a comment).

- [ ] **Step 1: Admin shell + guard**

`client/app/admin/layout.tsx` — `'use client'`; on mount `apiFetch<Me>('/auth/me')`; while loading render "Checking access…"; if role !== 'ADMIN' → `window.location.replace('/')`; else render `<div className="mx-auto max-w-6xl p-6">{children}</div>` with a small "Admin" subnav (Products link).

- [ ] **Step 2: `client/lib/admin-api.ts`**

Typed wrappers over `apiFetch` for the seven admin endpoints + `listProducts`, with a shared `AdminProduct` type mirroring the API response (id, type, slug, title, classLevel, subject, chapterNo, pricePaise, driveFileId, previewPaths, status, aliases: string[]). Keep it dumb — no state library.

- [ ] **Step 3: Pages + form**

Products table page (fetch on mount, refresh after mutations); `product-form.tsx` — controlled form covering the DTO fields (price entered in ₹, converted to paise on submit — comment the conversion), alias textarea (comma/newline separated → trimmed list), bundle child picker shown only when type is BUNDLE (loads NOTE products), and the two action buttons on the edit page (Verify Drive → shows `{ ok, name }` or the error message inline; Generate Previews → shows "queued (job …)" then a Refresh button reveals `previewPaths` thumbnails via `PUBLIC_MEDIA_BASE`... the client doesn't know that env — the API's product responses must return `previewUrls: string[]` alongside paths: add that mapping in the Task 6 controller responses (`storage.publicUrl(p)`) — implementer: inject `STORAGE_PROVIDER` in the admin controller and map before returning; adjust Task 6 spec assertions accordingly).

- [ ] **Step 4: Verify**

`npm --prefix client test` green, `npm --prefix client run build` clean, lint clean. Manual: sign in as ADMIN → `/admin/products` → create/edit/verify/preview flow works against the live API (screenshot-level description in the report). A non-admin (flip role back briefly, or incognito signed-out) hitting `/admin` bounces to `/`.

---

### Task 8: Public catalog API

**Files:**
- Create: `server/src/catalog/catalog.controller.ts`, `server/src/catalog/catalog.service.ts`, `server/src/catalog/catalog.service.spec.ts`, `server/src/catalog/catalog.module.ts`, `server/src/catalog/dto/list-products.dto.ts`

**Interfaces:**
- Consumes: `@CurrentTenant()`, `forTenant`, `STORAGE_PROVIDER` (publicUrl mapping)
- Produces (public, tenant-resolved, ACTIVE-only):
  - `GET /products?classLevel=&subject=&type=&sort=` — sort ∈ `newest` (default) | `price_asc` | `price_desc`; returns `{ items: PublicProduct[] }`
  - `GET /products/:slug` — `PublicProduct & { bundleItems?: {slug,title,chapterNo}[]; inBundles?: {slug,title,pricePaise}[] }` (upsell data); 404 if not ACTIVE or wrong tenant
  - `PublicProduct` = id, type, slug, title, description, classLevel, subject, chapterNo, pricePaise, coverUrl, previewUrls, status omitted
- DTO validates query params (`@IsOptional @IsIn(...)` etc., `transform: true` coerces classLevel to number).

- [ ] **Step 1: Service + controller + DTO** — straightforward `forTenant` queries; detail includes `bundleItems: { include: { note: { select: { slug: true, title: true, chapterNo: true, status: true } } } }` filtered to ACTIVE notes, and `inBundles: { include: { bundle: ... } }` filtered to ACTIVE bundles; map preview paths → URLs via storage.publicUrl. Register `CatalogModule`.

- [ ] **Step 2: Spec** — mocked prisma: (a) list filters by classLevel+subject and always injects `status: 'ACTIVE'`; (b) sort mapping (`price_asc` → `{ pricePaise: 'asc' }`, `newest` → `{ createdAt: 'desc' }`); (c) detail 404s on missing; (d) preview paths mapped to URLs. Suite green, build clean.

- [ ] **Step 3: Live check** — with servers up: `GET http://localhost:3001/products` returns the seeded ACTIVE products (only ones marked ACTIVE); `GET /products/class-10-maths-ch1-real-numbers` returns detail. (Seeded products have no previews — `previewUrls: []` is correct.)

---

### Task 9: Academic search (parser + trigram SQL + logging)

**Files:**
- Create: `server/src/search/query-parser.ts`, `server/src/search/query-parser.spec.ts`, `server/src/search/search.service.ts`, `server/src/search/search.service.spec.ts`, `server/src/search/search.controller.ts`, `server/src/search/search.module.ts`

**Interfaces:**
- Consumes: `PrismaService` (RAW `$queryRaw` — the sanctioned exception; manual tenantId), `@CurrentTenant()`, `STORAGE_PROVIDER`
- Produces:
  - `parseAcademicQuery(q: string): { classLevel?: number; subject?: Subject; chapterNo?: number; residual: string }` — pure
  - `SearchService.search(tenantId, q): Promise<PublicProduct[]>` — parse → filtered trigram query → log to SearchLog (via forTenant) → mapped results
  - `GET /search?q=` (public, tenant-resolved; 400 on missing/blank q; q trimmed, max 100 chars)

- [ ] **Step 1: TDD the parser**

`query-parser.spec.ts` — table-driven over the spec's examples:

```ts
import { parseAcademicQuery } from './query-parser';

describe('parseAcademicQuery', () => {
  const cases: Array<[string, ReturnType<typeof parseAcademicQuery>]> = [
    ['class 10 science carbon', { classLevel: 10, subject: 'SCIENCE', chapterNo: undefined, residual: 'carbon' }],
    ['ch 4 sci', { classLevel: undefined, subject: 'SCIENCE', chapterNo: 4, residual: '' }],
    ['Ch 5 Maths', { classLevel: undefined, subject: 'MATHS', chapterNo: 5, residual: '' }],
    ['real numbers', { classLevel: undefined, subject: undefined, chapterNo: undefined, residual: 'real numbers' }],
    ['sst history chapter 2', { classLevel: undefined, subject: 'SST', chapterNo: 2, residual: 'history' }],
    ['english first flight', { classLevel: undefined, subject: 'ENGLISH', chapterNo: undefined, residual: 'first flight' }],
    ['10th maths', { classLevel: 10, subject: 'MATHS', chapterNo: undefined, residual: '' }],
    ['class 9', { classLevel: 9, subject: undefined, chapterNo: undefined, residual: '' }],
    ['carbon and its compounds', { classLevel: undefined, subject: undefined, chapterNo: undefined, residual: 'carbon and its compounds' }],
    ['social science class 10', { classLevel: 10, subject: 'SST', chapterNo: undefined, residual: '' }],
  ];

  it.each(cases)('parses %s', (q, expected) => {
    expect(parseAcademicQuery(q)).toEqual(expected);
  });
});
```

Implement (`query-parser.ts`): lowercase + tokenize; subject synonym map — `sci|science → SCIENCE`, `math|maths|mathematics → MATHS`, `sst|social|social science → SST` (consume the two-word form first), `eng|english → ENGLISH`; class patterns `class 10|cls 10|10th|class 10th` (9 or 10 only); chapter patterns `ch 4|ch4|chapter 4`; everything unconsumed (order-preserving) joins into `residual`. RED → GREEN.

- [ ] **Step 2: SearchService (raw SQL, manually tenant-scoped)**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Subject } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { parseAcademicQuery } from './query-parser';

type Row = {
  id: string; type: string; slug: string; title: string; description: string;
  classLevel: number; subject: Subject; chapterNo: number | null;
  pricePaise: number; coverPath: string | null; previewPaths: string[]; score: number;
};

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async search(tenantId: string, rawQ: string) {
    const q = rawQ.trim().slice(0, 100);
    const parsed = parseAcademicQuery(q);
    const residual = parsed.residual;

    // RAW SQL — bypasses the tenant-scoping extension by design (trigram ranking
    // needs SQL functions Prisma can't express). tenantId is included MANUALLY
    // in the WHERE clause below; the isolation spec case guards this.
    const filters: Prisma.Sql[] = [
      Prisma.sql`p."tenantId" = ${tenantId}`,
      Prisma.sql`p.status = 'ACTIVE'`,
    ];
    if (parsed.classLevel) filters.push(Prisma.sql`p."classLevel" = ${parsed.classLevel}`);
    if (parsed.subject) filters.push(Prisma.sql`p.subject = ${parsed.subject}::"Subject"`);
    if (parsed.chapterNo) filters.push(Prisma.sql`p."chapterNo" = ${parsed.chapterNo}`);
    if (residual.length > 0) {
      filters.push(Prisma.sql`(
        word_similarity(${residual}, p.title) > 0.2
        OR p.title ILIKE '%' || ${residual} || '%'
        OR EXISTS (
          SELECT 1 FROM "ProductAlias" a
          WHERE a."productId" = p.id
            AND (word_similarity(${residual}, a.alias) > 0.25 OR a.alias ILIKE '%' || ${residual} || '%')
        )
      )`);
    }

    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.id, p.type, p.slug, p.title, p.description, p."classLevel",
             p.subject, p."chapterNo", p."pricePaise", p."coverPath", p."previewPaths",
             GREATEST(
               word_similarity(${residual}, p.title),
               COALESCE((SELECT MAX(word_similarity(${residual}, a.alias))
                         FROM "ProductAlias" a WHERE a."productId" = p.id), 0)
             ) AS score
      FROM "Product" p
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY score DESC, p."classLevel" ASC, p."chapterNo" ASC NULLS LAST, p.title ASC
      LIMIT 20
    `);

    await this.prisma.forTenant(tenantId).searchLog.create({
      data: { query: q, resultCount: rows.length },
    });

    return rows.map(({ score: _score, coverPath, previewPaths, ...rest }) => ({
      ...rest,
      coverUrl: coverPath ? this.storage.publicUrl(coverPath) : null,
      previewUrls: previewPaths.map((p) => this.storage.publicUrl(p)),
    }));
  }
}
```

(Edge note for the implementer: when `residual` is empty, `word_similarity('', ...)` returns 0 for everything — score ties broken by class/chapter ordering, which is the desired "filters-only" behavior.)

- [ ] **Step 3: Service spec + THE ISOLATION TEST**

`search.service.spec.ts` with mocked `$queryRaw`: (a) parses and forwards filters — inspect the `Prisma.Sql` passed: assert `sql.values` CONTAINS the tenantId argument (this is the isolation regression lock: if someone removes the manual tenant filter, `values` loses the tenantId and this fails); (b) SearchLog written via forTenant with resultCount; (c) result mapping to URLs; (d) q longer than 100 chars is truncated. Controller: 400 on blank q.

- [ ] **Step 4: Live search smoke**

Servers up: `GET http://localhost:3001/search?q=carbon` → Carbon note ranked first; `?q=carbon compunds` (typo) still finds it; `?q=ch 1 maths` → Real Numbers; `?q=class 9` → the SST note. `SearchLog` rows appear (prisma studio). Include outputs in the report.

---

### Task 10: Product listing page + search UI

**Files:**
- Create: `client/app/notes/page.tsx`, `client/components/product-card.tsx`, `client/components/catalog-filters.tsx`, `client/lib/catalog.ts`
- Modify: `client/app/page.tsx` (home links into the catalog), `client/components/site-header.tsx` (add a "Browse Notes" nav link)

**Interfaces:**
- Consumes: `apiServerFetch` (SSR), `GET /products`, `GET /search`
- Produces: `/notes` — server component reading `searchParams` (`classLevel`, `subject`, `sort`, `q`); when `q` present fetch `/search?q=`, else `/products?...`; renders the capsule filters + grid. `PublicProduct` type + fetchers in `client/lib/catalog.ts`.

- [ ] **Step 1: `client/lib/catalog.ts`** — `PublicProduct` type mirroring Task 8; `fetchProducts(params)` and `searchProducts(q)` via `apiServerFetch` with `URLSearchParams`.

- [ ] **Step 2: Components**

`product-card.tsx` (server component): cover image (or a subject-colored placeholder `div` when `coverUrl` null), title, `Class {classLevel} • {subject}{chapterNo ? ` • Ch ${chapterNo}` : ''}`, price `₹{(pricePaise / 100).toFixed(0)}`, BUNDLE badge when type is bundle, wraps in `<Link href={`/notes/${slug}`}>`.

`catalog-filters.tsx` (server component — pure links, no client JS): class capsules (All / Class 9 / Class 10) and subject capsules (All / Science / Maths / SST / English) as `<Link>`s that preserve the other params (build hrefs with `URLSearchParams`); active capsule = solid `var(--brand-primary)` background, inactive = outlined; a sort `<Link>` trio (Newest / ₹ low→high / ₹ high→low); and a search `<form action="/notes" method="get">` with `<input name="q" defaultValue={q}>` + submit button (GET form = zero client JS).

- [ ] **Step 3: Page**

`client/app/notes/page.tsx`:

```tsx
import { fetchProducts, searchProducts } from '@/lib/catalog';
import { ProductCard } from '@/components/product-card';
import { CatalogFilters } from '@/components/catalog-filters';

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const q = params.q?.trim();
  const items = q
    ? await searchProducts(q)
    : await fetchProducts({ classLevel: params.classLevel, subject: params.subject, sort: params.sort });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">Browse Notes</h1>
      <CatalogFilters current={params} />
      {q ? <p className="mt-2 text-sm text-gray-600">{items.length} result(s) for “{q}”</p> : null}
      {items.length === 0 ? (
        <p className="mt-8 text-gray-600">
          Nothing found. Try a chapter name like “carbon” or “real numbers” — or tell us what you need on the enquiry page (coming soon).
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}
```

(Next 16 note: `searchParams` is a Promise in current App Router — verify against `client/node_modules/next/dist/docs/` and adjust if the installed version differs.)

Home page: replace the placeholder copy with a hero line + `<Link href="/notes">Browse all notes</Link>` button + a small grid of the first 4 products (`fetchProducts({ sort: 'newest' })`, slice 4). Header: add `Browse Notes` link before the auth controls.

- [ ] **Step 4: Verify**

Client tests green, build clean, lint clean. Manual: `/notes` shows the seeded grid; capsules filter (Class 9 shows only the SST note); sort flips order; searching `carbon` from the box lands on results; empty-search state renders. Mobile width (devtools) — grid collapses to 2 columns, capsules wrap.

---

### Task 11: Product detail page + bundle upsell

**Files:**
- Create: `client/app/notes/[slug]/page.tsx`, `client/components/preview-gallery.tsx`
- Modify: `client/lib/catalog.ts` (add `fetchProduct(slug)`)

**Interfaces:**
- Consumes: `GET /products/:slug` (with `bundleItems` / `inBundles`)
- Produces: `/notes/[slug]` — preview gallery (main image + thumbnail strip, client component with `useState` for selected index), title/meta/price block, sticky mobile buy bar, "Buy" button that is a **disabled placeholder labelled "Checkout coming soon"** (Phase 3 wires it — do NOT build cart state now), bundle contents list (for bundles), upsell card (for notes that are `inBundles`: "Get the full {bundle.title} — ₹{price}"), `generateMetadata` from the product (title + description for SEO), `notFound()` on 404.

- [ ] **Step 1: `fetchProduct(slug)`** — `apiServerFetch`, catching the 404 → return null; page calls `notFound()` from `next/navigation` on null.

- [ ] **Step 2: Gallery + page** — `preview-gallery.tsx` `'use client'`: props `{ urls: string[]; title: string }`; if empty, render the subject placeholder block; else main `<img>` (plain img is fine for API-served media; add `alt`) + clickable thumbnails. Page layout: two columns on md+ (gallery left, info right), stacked on mobile with a sticky bottom bar (`fixed bottom-0 inset-x-0 md:hidden`) showing price + the disabled buy button. Upsell card links to the bundle's PDP.

- [ ] **Step 3: Verify** — build/tests/lint green. Manual: seeded note PDP renders (no previews → placeholder); the product you gave real previews in Task 6's smoke shows the watermarked gallery; the bundle PDP lists its child chapter; the child note shows the upsell card; unknown slug → Next 404 page; mobile sticky bar present.

---

### Task 12: Phase 2 exit verification (manual checklist + suite gate)

No new code (fix-forward only if a check fails).

- [ ] Full gates: `npm --prefix server test`, `npm --prefix client test`, both builds, both lints — all green.
- [ ] Admin flow end-to-end on live servers: create note product w/ real Drive file → verify-drive → generate-previews → previews appear on the PDP within a worker tick.
- [ ] Catalog: `/notes` filters + sort + search (typo included) behave; PDP + bundle upsell render; DRAFT products invisible publicly but visible in `/admin`.
- [ ] Isolation spot-check: with a second tenant row added temporarily via Prisma Studio (domains `["demo.localhost"]`, ACTIVE), `http://demo.localhost:3000/notes` shows an EMPTY catalog (no cross-tenant leakage) and its own 404-free branding fallback; search on demo.localhost returns nothing and logs to the demo tenant's SearchLog. Remove or keep the demo tenant afterward (user's choice — keeping it is useful).
- [ ] `SearchLog` accumulating rows with counts; a zero-result query shows up with `resultCount: 0`.
- [ ] Record everything in `.superpowers/sdd/phase2-exit-report.md`.

## Phase 2 exit criteria

- All suites/builds/lints green (server suites include: jobs math+service, drive, storage, previews render/watermark/service, roles guard, admin controller, catalog, parser, search incl. the tenantId-in-values isolation lock).
- An admin can take a real Drive PDF from file-id to watermarked previews on a live product page without touching a terminal.
- Students can filter, sort, and typo-search the catalog; PDPs show previews and bundle upsells; drafts stay hidden.
- Search queries are logged with result counts (the zero-result list = the client's content roadmap, per spec §7).
- A second tenant on a second local domain sees an isolated, empty store.

**Next:** Phase 3 plan (cart, PaymentProvider + Razorpay/manual-UPI, webhook, Drive grants + delivery email via the now-live worker, student dashboard).


