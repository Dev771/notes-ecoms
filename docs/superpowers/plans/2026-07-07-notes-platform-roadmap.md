# Notes Platform — Implementation Roadmap

**Spec:** `docs/superpowers/specs/2026-07-07-notes-platform-design.md`

The MVP ships in four phases. Each phase has (or will get) its own detailed
plan in this directory, and each ends with working, testable software.
Later-phase plans are written when the prior phase completes, so they can
reflect what actually got built.

| Phase | Plan doc | Delivers | Spec sections |
|---|---|---|---|
| 1. Foundation | `2026-07-07-phase-1-foundation.md` (ready) | Next.js 16 scaffold, full Prisma schema + migrations, tenant resolution from Host header, tenant-scoped Prisma client, secrets encryption, seed data, Google sign-in with tenant-scoped user provisioning, branded base layout | §2, §3, §6 (schema), part of §8 (layout) |
| 2. Catalog & search | written after Phase 1 | Product/bundle/alias admin CRUD, Drive service-account client + verify-access, preview generation from Drive PDFs (outbox job), PLP with capsule filters, PDP with previews + bundle upsell, academic search (parser + pg_trgm) + search logging | §4 (preview gen, verify), §7, §8 (PLP/PDP), part of §9 |
| 3. Checkout & fulfillment | written after Phase 2 | Cart, PaymentProvider interface, Razorpay gateway mode + webhook (signature, dedupe), manual UPI mode + admin confirm, fulfillment jobs (Drive grant, delivery email via Resend), entitlements, student dashboard, refund-with-revoke | §4 (grants/revocation), §5, §8 (checkout/dashboard) |
| 4. Admin, content & launch | written after Phase 3 | Admin analytics (revenue, AOV, top/zero-result searches), orders/customers screens, enquiry form + inbox, blog (DB-backed markdown), home page (hero, trust bar, Instagram embeds, bundles strip), policy pages, audit log, Playwright happy path, launch checklist (hosting move, real domains, KYC switch) | §8 (home/blog/about), §9, §10, §12 |

Dependency order is strict: 2 needs the schema/tenancy from 1; 3 needs
products from 2; 4 reads data produced by 3.
