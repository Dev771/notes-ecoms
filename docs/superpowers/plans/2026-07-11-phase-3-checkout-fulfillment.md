# Phase 3: Checkout & Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Money in, notes out: a student carts notes, signs in, pays (Razorpay test mode or manual-UPI), and the platform automatically grants their Google account view access to the purchased Drive files and emails them — with a student dashboard showing their notes and orders, and admin screens to confirm manual payments, refund-with-revoke, and unstick jobs.

**Architecture:** Everything money- and delivery-critical lives in `server/` behind the patterns Phase 1–2 established: tenant-scoped Prisma (`forTenant`), the outbox worker (two new handlers: `DRIVE_GRANT`, `DELIVERY_EMAIL`), per-tenant encrypted gateway credentials (Phase 1's `encryptSecret`), webhook idempotency via the `WebhookEvent` PK, and the `PaymentProvider` interface so gateway swaps stay config-level. The client adds a localStorage cart, checkout flow, success-page polling, and the student dashboard.

**Tech Stack additions:** `razorpay` (server SDK), `resend` (email). No other new services — no Redis, no queues, per the spec.

**Reference-by-file convention:** where a step says "mirror `<path>`", the committed file is the authoritative pattern (module wiring, spec scaffolding, guard usage) — transcribe its shape, not its content. All NEW logic in this plan carries complete code.

## Global Constraints

- Everything from Phases 1–2 stands: agents NEVER commit (user commits personally); TS strict; Prettier both apps; Jest colocated server specs / Vitest in `client/tests`; money in integer paise; client env = `NEXT_PUBLIC_API_URL` only.
- ALL money math server-side: order totals computed from DB prices at order-creation, never trusted from the client. Prices snapshot into `OrderItem.pricePaise`/`titleSnapshot`.
- Tenant scoping via `forTenant` everywhere; the ONLY new raw-SQL/raw-client surface allowed is none — webhooks resolve their tenant from the URL slug, then use `forTenant`.
- Webhook handlers are IDEMPOTENT (event-ID dedupe via `WebhookEvent` create-or-ignore) and verify signatures over the RAW request body before any parsing side effects.
- Fulfillment must never look like a lost payment: order status transitions are atomic with job enqueue (`$transaction`), and the success page shows "being prepared" for pending items.
- Gateway secrets stored ONLY via `encryptSecret` on the tenant row; decrypted per-call server-side; never logged, never in responses.
- Drive grants: `permissions.create` with `sendNotificationEmail: false`; permission ID stored on the entitlement; revocation = `permissions.delete` by stored ID. (Copy-protection = owner-checklist model per spec §4 — no grant-time flag writes.)
- New server env: `RESEND_API_KEY`, `RESEND_FROM` (dev default `onboarding@resend.dev`). Both in `.env.example` same-commit.
- JobsModule remains the single `JOB_HANDLERS` aggregation point (see its comment) — new handlers register THERE.

---

### Task 0: Manual prerequisites (human, one-time)

- [ ] **Step 1:** Create a Razorpay account (test mode is enough — no KYC needed for test keys): dashboard.razorpay.com → Settings → API Keys → Generate test key. Note `key_id` (rzp_test_…) and `key_secret`.
- [ ] **Step 2:** Settings → Webhooks → we'll add the URL after Task 4 lands (needs a public tunnel or we test with simulated payloads — the plan's Task 4 includes a signature-simulation path so a tunnel is OPTIONAL for dev). Choose a webhook secret string now and note it.
- [ ] **Step 3:** Create a free Resend account (resend.com) → API Keys → create. Put `RESEND_API_KEY="re_..."` into `server/.env`. Dev sending uses `onboarding@resend.dev` (no domain verification needed); real domain sending is a Phase 4 launch item.
- [ ] **Step 4:** After Task 3 lands, store the Razorpay credentials on the tenant via the new admin endpoint (exact curl given in Task 3 Step 4) — or tell the controller the three values and it will run it.

---

### Task 1: Kickoff hardening trio (schema default, job reclaim, docs)

**Files:**
- Modify: `server/prisma/schema.prisma` (+ new migration), `server/src/jobs/jobs.service.ts`, `server/src/jobs/jobs.service.spec.ts`, `server/src/jobs/job-math.ts`, `server/src/jobs/job-math.spec.ts`

**Interfaces:**
- Produces: `previewPaths String[] @default([])` (+ NULL backfill migration); `FulfillmentJob.claimedAt DateTime?`; stale-RUNNING reclaim in the worker tick; `isStale(claimedAt, now, leaseMs)` pure fn.

- [ ] **Step 1: Schema changes + migration.** In `schema.prisma`: `previewPaths String[] @default([])` and add `claimedAt DateTime?` to `FulfillmentJob`. `cd server; npx prisma migrate dev --name preview_default_and_job_claims --create-only`, then EDIT the generated SQL to append a backfill: `UPDATE "Product" SET "previewPaths" = '{}' WHERE "previewPaths" IS NULL;` (and same idea is NOT needed for claimedAt — nullable). Apply with `npx prisma migrate dev`. Verify: `docker exec notes-platform-pg psql -U postgres -d notes -t -c "SELECT count(*) FROM \"Product\" WHERE \"previewPaths\" IS NULL;"` → 0.
- [ ] **Step 2: TDD `isStale`.** In `job-math.spec.ts` add: `isStale(null, now, 600000)` → false; claimed 11 min ago with 10-min lease → true; 5 min ago → false. Implement in `job-math.ts`: `export function isStale(claimedAt: Date | null, now: Date, leaseMs: number): boolean { return claimedAt !== null && now.getTime() - claimedAt.getTime() > leaseMs; }`
- [ ] **Step 3: Worker reclaim + claim stamping.** In `jobs.service.ts`: claim update sets `claimedAt: new Date()`; at the top of `processDueJobs`, before claiming, run a reclaim sweep: `updateMany({ where: { status: 'RUNNING', claimedAt: { lt: new Date(Date.now() - LEASE_MS) } }, data: { status: 'PENDING', claimedAt: null, lastError: 'reclaimed: stale RUNNING lease' } })` with `const LEASE_MS = 600_000; // 10 min — generous vs the 60s render timeout` and update the known-limitation comment to say the gap is now closed. Spec: add a case asserting the reclaim updateMany is issued with a `status: 'RUNNING'` + `claimedAt lt` filter, and that claims stamp `claimedAt`.
- [ ] **Step 4:** Full server suite green; `tsc --noEmit`; scoped prettier/lint. NO commit.

---

### Task 2: Orders API (create + read, server-priced)

**Files:**
- Create: `server/src/orders/orders.service.ts`, `server/src/orders/orders.service.spec.ts`, `server/src/orders/orders.controller.ts`, `server/src/orders/orders.module.ts`, `server/src/orders/dto/create-order.dto.ts`
- Modify: `server/src/app.module.ts` (register OrdersModule)

**Interfaces:**
- Consumes: `JwtAuthGuard` + `@CurrentUserClaims()`, `@CurrentTenant()`, `forTenant`
- Produces:
  - `CreateOrderDto { productIds: string[] }` (`@ArrayNotEmpty @ArrayMaxSize(20) @ArrayUnique @IsString({each}) @MaxLength(40,{each})`)
  - `OrdersService.createOrder(tenantId, userId, productIds)` — loads ACTIVE products tenant-scoped; 400 if any id unresolved; computes `totalPaise` = Σ pricePaise SERVER-SIDE; `$transaction`: create Order (status PENDING, paymentMode from tenant) + OrderItems with `titleSnapshot`/`pricePaise` snapshots; returns order with items.
  - `OrdersService.getOwnOrder(tenantId, userId, orderId)` — 404 unless the order belongs to userId (guards IDOR); used by the success page poller.
  - `OrdersService.listOwnOrders(tenantId, userId)` — newest first, items included.
  - Public shape `OrderView { id, status, totalPaise, paymentMode, createdAt, items: {productId, titleSnapshot, pricePaise}[] }` — never expose gateway ids/UTR to other users; own orders may include `utrReference`.
  - Routes (ALL `@UseGuards(JwtAuthGuard)`): `POST /orders` (dto → createOrder for the CALLER's userId from claims — never accept a userId in the body), `GET /orders/:id`, `GET /me/orders`.
- Spec cases: server-side pricing ignores any client-sent price; unresolved/foreign product id → 400 (tenant-scoped resolution proves isolation); IDOR: other-user's order id → 404; snapshots persisted; transaction used (assert `$transaction` called). Mirror mock patterns from `server/src/catalog/catalog.service.spec.ts`.
- Module wiring mirrors `server/src/catalog/catalog.module.ts`. Boot check: routes 401 without token.

---

### Task 3: PaymentProvider + Razorpay provider + tenant payment-config admin endpoint

**Files:**
- Create: `server/src/payments/payment-provider.ts`, `server/src/payments/razorpay.provider.ts`, `server/src/payments/razorpay.provider.spec.ts`, `server/src/payments/signature.ts`, `server/src/payments/signature.spec.ts`, `server/src/payments/payments.module.ts`
- Modify: `server/src/admin/admin-products.controller.ts`… NO — create `server/src/admin/admin-tenant.controller.ts` instead (tenant settings grow; keep products controller focused), register in AdminModule.

**Interfaces:**
- Produces:
  - `interface PaymentProvider { createGatewayOrder(args: { tenantId: string; orderId: string; amountPaise: number }): Promise<{ gatewayOrderId: string; keyId: string }> }` + `PAYMENT_PROVIDER` token (Razorpay impl bound; Cashfree later = new binding).
  - `RazorpayProvider` — decrypts tenant keys per call (`decryptSecret`), lazy `new Razorpay({key_id, key_secret})` per tenant (memoized Map, mirror `PrismaService.forTenant` memoization), `orders.create({ amount: amountPaise, currency: 'INR', receipt: orderId, notes: { orderId, tenantId } })`.
  - **`verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean`** — pure, TDD FIRST: `createHmac('sha256', secret).update(rawBody).digest('hex')` compared with `timingSafeEqual` (length-guarded). Spec: valid sig passes; flipped byte fails; different secret fails; length mismatch fails without throwing.
  - `PUT /admin/tenant/payment-config` (ADMIN, DTO `{ razorpayKeyId: string; razorpayKeySecret: string; razorpayWebhookSecret: string; paymentMode: 'GATEWAY' | 'MANUAL_UPI'; upiVpa?: string }`) — stores secrets via `encryptSecret` on the tenant row (raw `prisma.tenant.update` — Tenant is exempt, comment it); response returns key ID + mode ONLY (never secrets). Plus `GET /admin/tenant/payment-config` returning `{ paymentMode, razorpayKeyId, upiVpa, webhookSecretSet: boolean }`.
- Task 0 Step 4's curl (document in the report): `curl -X PUT :3001/admin/tenant/payment-config -H "Authorization: Bearer <ADMIN_JWT>" -H "Content-Type: application/json" -d '{"razorpayKeyId":"rzp_test_...","razorpayKeySecret":"...","razorpayWebhookSecret":"...","paymentMode":"GATEWAY"}'`
- Razorpay SDK calls mocked in specs (inject a client factory like `DriveService` does — mirror `server/src/drive/drive.service.ts`'s injectable-factory + lazy pattern exactly, including the boot-without-creds property).

---

### Task 4: Razorpay webhook (raw body, signature, dedupe, mark-paid pipeline)

**Files:**
- Create: `server/src/payments/webhook.controller.ts`, `server/src/payments/webhook.controller.spec.ts`, `server/src/orders/order-fulfillment.service.ts`, `server/src/orders/order-fulfillment.service.spec.ts`
- Modify: `server/src/main.ts` (raw-body for the webhook route), `server/src/app.module.ts` (TenantMiddleware EXCLUDE `webhooks/razorpay/:tenantSlug` — tenant comes from the slug, not Origin)

**Interfaces:**
- Produces:
  - `POST /webhooks/razorpay/:tenantSlug` — NO auth guard (Razorpay calls it); resolves tenant by slug (`TenantService.bySlug` — add this trivial method), 404 unknown; verifies `x-razorpay-signature` against the RAW body with the tenant's decrypted webhook secret → 400 on mismatch; parses; handles `payment.captured` (others → 200 ignored, log event type).
  - Idempotency: `WebhookEvent.create({ id: event.id (header `x-razorpay-event-id` or payload id), tenantId })` inside try/catch — P2002 duplicate → 200 early-return (already processed).
  - `OrderFulfillmentService.markPaidAndEnqueue(tenantId, orderId, { gatewayPaymentId? })` — THE single mark-paid path (webhook AND manual confirm both call it): `$transaction`: order PENDING/PENDING_VERIFICATION → PAID (idempotent: already-PAID → no-op return), **bundle expansion**: for each order item, if product type BUNDLE load its `bundleItems` (raw-client `bundleItem.findMany` — exempt, comment — filtered by the tenant-validated bundle id) and resolve child NOTE ids, else the note id itself; upsert `Entitlement` per (userId, noteProductId) status PENDING (skip existing ACTIVE); enqueue ONE `DRIVE_GRANT` job per new/pending entitlement `{ entitlementId }` + ONE `DELIVERY_EMAIL` job `{ orderId }`.
  - Raw body: in `main.ts`, `NestFactory.create(AppModule, { rawBody: true })` and the controller uses `@Req() req: RawBodyRequest<Request>` → `req.rawBody` (Nest 11 built-in; verify against installed @nestjs/common types).
- Spec cases (TDD the service first): bad signature → 400, no side effects; duplicate event id → 200, single processing; payment.captured on unknown order → 200 + warn (never 500 to Razorpay); already-PAID idempotency; bundle expands to child entitlements; existing ACTIVE entitlement not re-granted but still gets no duplicate job; transaction atomicity (mock).
- **Dev verification without a public tunnel:** spec-level simulation + a live curl with a hand-computed valid signature over a fixture payload (script in the report; the signature util makes this easy). A real Razorpay dashboard webhook is a Phase 4 launch-checklist item.

---

### Task 5: Manual-UPI mode (UTR submit + admin confirm)

**Files:**
- Create: `server/src/orders/manual-payment.controller.ts` + spec, `server/src/admin/admin-orders.controller.ts` + spec
- Modify: `server/src/orders/orders.module.ts`, `server/src/admin/admin.module.ts`

**Interfaces:**
- `POST /orders/:id/utr` (JwtAuthGuard, owner-checked via `getOwnOrder`) body `{ utr: string }` (`@Matches(/^[A-Za-z0-9]{6,30}$/)`): allowed only when order PENDING and tenant.paymentMode MANUAL_UPI → sets `utrReference`, status PENDING_VERIFICATION.
- `GET /orders/:id/payment-instructions` (owner): returns `{ mode, upiVpa, amountPaise, reference: order.id }` for the manual screen (404 in GATEWAY mode).
- Admin (`/admin/orders`, ADMIN-guarded, new controller):
  - `GET /admin/orders?status=` — list with user email + items.
  - `POST /admin/orders/:id/confirm-payment` — PENDING_VERIFICATION only → calls `OrderFulfillmentService.markPaidAndEnqueue` (the same pipeline — this is the bridge's whole point).
  - `POST /admin/orders/:id/reject-payment` — PENDING_VERIFICATION → FAILED with a note field appended to `utrReference` (` | rejected: <reason>` — no schema change).
  - `GET /admin/jobs?status=DEAD` + `POST /admin/jobs/:id/retry` (reset attempts 0, status PENDING, nextRunAt now) — the dead-letter surface the spec promises.
- Spec cases: wrong-mode 404s; non-owner 404; state-machine guards (PAID order rejects UTR; confirm on PENDING → 409); confirm calls the shared pipeline (spy).

---

### Task 6: Fulfillment handlers — DRIVE_GRANT + DELIVERY_EMAIL (+ refund/revoke)

**Files:**
- Create: `server/src/fulfillment/drive-grant.handler.ts` + spec, `server/src/fulfillment/delivery-email.handler.ts` + spec, `server/src/fulfillment/fulfillment.module.ts`, `server/src/email/email.service.ts` + spec, `server/src/email/email.module.ts`
- Modify: `server/src/drive/drive.service.ts` (+2 methods + spec cases), `server/src/jobs/jobs.module.ts` (aggregate the two new handlers — follow its comment EXACTLY), `server/src/admin/admin-orders.controller.ts` (refund endpoint)

**Interfaces:**
- `DriveService.grantReader(fileId, email): Promise<{ permissionId: string }>` — `permissions.create({ fileId, requestBody: { role: 'reader', type: 'user', emailAddress: email }, sendNotificationEmail: false, supportsAllDrives: true })`; map 404/403 like existing methods. `DriveService.revokePermission(fileId, permissionId): Promise<void>` — `permissions.delete`, treat 404 as success (already gone). Specs mirror existing drive spec style.
- `DriveGrantHandler` (`type: 'DRIVE_GRANT'`, payload `{ entitlementId }`): load entitlement + product + user via `forTenant(job.tenantId)`; skip if already ACTIVE with permissionId (idempotent retry); grant via product.driveFileId + user.email; update entitlement `{ status: 'ACTIVE', drivePermissionId }`. Missing driveFileId → throw (job retries/dead-letters — admin fixes the product then retries).
- `EmailService.sendDeliveryEmail({ to, tenantName, items: {title, driveFileId}[] })` — Resend SDK (lazy client, env-guarded like crypto's masterKey pattern); HTML kept as a simple inline template function `renderDeliveryEmail(...): string` (pure, TDD: contains each title + `https://drive.google.com/file/d/<id>/view` link + tenant name; escapes HTML in titles — reuse the escaping approach from `server/src/previews/watermark.ts`).
- `DeliveryEmailHandler` (`type: 'DELIVERY_EMAIL'`, payload `{ orderId }`): load order + items + user; ONLY include items whose entitlement is ACTIVE… simpler + correct per spec ("dashboard shows being-prepared"): include ALL items with their Drive links — grants may still be settling; links work once granted. Send once; rely on job idempotency note: a retried email may re-send — acceptable, note in comment.
- Refund: `POST /admin/orders/:id/refund` (ADMIN): order PAID → status REFUNDED; for each entitlement of the order's user for the order's (expanded) products: `revokePermission` (best-effort loop, collect failures into response), entitlement → REVOKED. (Razorpay money-refund itself is manual in the dashboard for MVP — comment + return note in response.)
- `JOB_HANDLERS` aggregation: `useFactory: (p, g, e) => [p, g, e], inject: [PreviewGenerationHandler, DriveGrantHandler, DeliveryEmailHandler]` in JobsModule; boot log must list all three types.

---

### Task 7: Client checkout — cart, checkout page, success polling

**Files:**
- Create: `client/lib/cart.ts`, `client/tests/cart.test.ts`, `client/components/cart-button.tsx`, `client/app/cart/page.tsx`, `client/app/checkout/page.tsx`, `client/app/checkout/success/[orderId]/page.tsx`, `client/lib/orders-api.ts`
- Modify: `client/components/site-header.tsx` (cart button), `client/components/product-card.tsx` + `client/app/notes/[slug]/page.tsx` (real Add-to-Cart replaces the disabled placeholder — PDP button becomes a client component `add-to-cart-button.tsx`)

**Interfaces:**
- `client/lib/cart.ts` — pure + localStorage: `getCart(): CartItem[]` (`{productId, slug, title, pricePaise, type}`), `addToCart(item)` (dedupe by productId), `removeFromCart(productId)`, `clearCart()`, `cartTotalPaise(items)`; emits a `window.dispatchEvent(new Event('cart-updated'))` on writes; header button subscribes. TDD the pure parts (Vitest, jsdom-free: inject a storage stub).
- `orders-api.ts`: `createOrder(productIds) → OrderView`; `getOrder(id)`; `getPaymentInstructions(id)`; `submitUtr(id, utr)`; `listMyOrders()`; plus `createGatewayCheckout(orderId) → { gatewayOrderId, keyId, amountPaise }` hitting `POST /orders/:id/gateway-checkout`… **ADD that endpoint in Task 3's controller scope? No — add here server-side is out of scope; correction:** the endpoint belongs server-side: add `POST /orders/:id/gateway-checkout` to `server/src/orders/orders.controller.ts` in **Task 3** (owner-checked; GATEWAY mode only; calls `PAYMENT_PROVIDER.createGatewayOrder`, persists `gatewayOrderId`, returns `{ gatewayOrderId, keyId, amountPaise }`). ← Task 3's implementer: include it + spec case.
- Checkout page ('use client'): requires sign-in (`getAuthToken()` else CTA to sign in with returnTo back to /checkout); on mount `createOrder(cart productIds)`; then by `paymentMode` from `getPaymentInstructions` 404-probe or include mode in OrderView (it's there): GATEWAY → load `https://checkout.razorpay.com/v1/checkout.js` (dynamic script tag — document CSP implications for Phase 4), open Razorpay with `{ key: keyId, order_id: gatewayOrderId, handler: () => router to success page }`; MANUAL_UPI → render UPI screen: VPA + amount + order reference + UPI deep-link QR is Phase 4 polish — text VPA + copy button now + UTR input → `submitUtr` → success page.
- Success page: poll `getOrder(id)` every 3s (max ~2 min): PENDING_VERIFICATION → "We're verifying your payment…"; PAID → "Your notes are ready / being prepared" + link to dashboard; FAILED → message + support email. Clear cart on first PAID/PENDING_VERIFICATION render.
- Tests: cart pure functions; orders-api wrapper shapes (mirror `client/tests/admin-api.test.ts` style).

---

### Task 8: Student dashboard (My Notes + orders)

**Files:**
- Create: `client/app/account/page.tsx`, `client/components/my-note-card.tsx`, server: `GET /me/entitlements` in `server/src/orders/orders.controller.ts` (+service method + spec)
- Modify: `client/components/site-header.tsx` (link "My Notes" when signed in)

**Interfaces:**
- Server `GET /me/entitlements` (JwtAuthGuard): entitlements for claims.userId with product {slug, title, classLevel, subject, chapterNo, coverUrl?, driveFileId when ACTIVE}; status included. Never expose driveFileId for non-ACTIVE.
- `/account` ('use client', token-gated like /admin layout): "My Notes" grid — ACTIVE → "Open in Drive" (`https://drive.google.com/file/d/<driveFileId>/view`, target _blank); PENDING → "Access being prepared…" badge (spec §5 promise); REVOKED → hidden. Below: order history via `listMyOrders` (date, items, ₹, status chip).
- Spec/test: server method scoping (only own entitlements — IDOR case); driveFileId withheld unless ACTIVE.

---

### Task 9: Admin orders UI

**Files:**
- Create: `client/app/admin/orders/page.tsx`, `client/lib/admin-orders-api.ts`
- Modify: `client/app/admin/layout.tsx` (subnav + "Orders")

**Interfaces:** wrappers for `GET /admin/orders?status=`, confirm/reject/refund, `GET /admin/jobs?status=DEAD`, retry. Orders table with status filter capsules (PENDING_VERIFICATION default view — that's the action queue), per-row: user email, items, ₹, UTR shown for verification, Confirm/Reject buttons (confirm() guards), Refund on PAID rows; below, a DEAD-jobs panel with lastError + Retry. Mirror `client/app/admin/products/page.tsx` conventions.

---

### Task 10: Phase 3 exit verification (controller- or agent-run)

- [ ] All suites/builds/lints green (server now ~30 suites incl. payments/orders/fulfillment/email; client incl. cart/orders tests).
- [ ] **Manual-UPI end-to-end LIVE:** cart → checkout (signed in) → UPI screen → submit fake UTR → admin confirms in /admin/orders → within a worker tick: entitlement ACTIVE with a REAL Drive permission id, delivery email sent (Resend dashboard/log), My Notes shows "Open in Drive", and the granted Google account can actually open the file (user click-verifies).
- [ ] **Gateway mode with test keys:** payment-config stored via admin endpoint; `gateway-checkout` returns a real rzp_test order id; webhook simulated with a correctly-signed fixture → order PAID → same fulfillment chain. (Real dashboard webhook = Phase 4.)
- [ ] Refund: admin refund → permission revoked on Drive (verify via SA `permissions.list` or re-open attempt fails), entitlement REVOKED, note hidden from My Notes.
- [ ] Idempotency: replay the same signed webhook → single processing; re-confirm attempt → 409.
- [ ] Isolation spot-check: demo-tenant admin JWT cannot see/confirm default-tenant orders (404s).
- [ ] Record in `.superpowers/sdd/phase3-exit-report.md`.

## Phase 3 exit criteria

- A student can buy with manual-UPI end-to-end and open their purchased note in Drive from "My Notes" — with the admin confirming from the browser.
- Gateway mode works against Razorpay test keys up to a simulated-signature webhook completing fulfillment.
- Refund revokes real Drive access and the dashboard reflects it.
- Webhook signature verification, event dedupe, order state machine, IDOR guards, and bundle expansion are all unit-locked.
- No payment can result in silent non-delivery: failures land in retries → dead-letter → admin retry surface.

**Next:** Phase 4 plan (admin analytics, enquiry, blog, homepage, policies, Playwright, launch checklist).
