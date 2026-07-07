# Notes Platform â€” MVP Architecture & Design

**Date:** 2026-07-07
**Status:** Approved pending final user review
**Inputs:** Client BRD/PRD (D2C Handwritten Notes Platform v1.0), discovery Q&A

## 1. Context and decisions

A tuition institute sells handwritten CBSE Class 9/10 notes (Science, Maths, SST, English) as view-only Google Drive files, â‚¹49â€“â‚¹99 per chapter plus subject bundles. The BRD/PRD defines the functional scope; this document defines how it gets built.

Decisions made during discovery:

| Decision | Choice | Rationale |
|---|---|---|
| Tenancy | One shared multi-tenant app, single client at launch | More clients expected within ~6â€“12 months; tenant-aware schema is cheap now, painful to retrofit |
| Drive ownership | Client keeps notes in their own Drive, connects it to the platform | Client retains IP custody; onboarding stays repeatable per tenant |
| Budget | ~Free until revenue | Free tiers throughout; only real cost is the domain |
| Architecture | Approach A: single Next.js full-stack app | New client = config row + DNS, not a new deployment or codebase fork |

## 2. Stack

One **Next.js 16** app (App Router, TypeScript, Tailwind CSS): storefront, student dashboard, admin panel, and all backend logic as route handlers.

| Concern | Service | Notes |
|---|---|---|
| Database | Supabase Postgres + **Prisma** | Free 500MB; `pg_trgm` extension powers fuzzy search |
| Auth | Supabase Auth | Google OAuth (required for Drive delivery anyway) |
| File storage | Supabase Storage | Cover images + watermarked previews, auto-generated from the note's own Drive PDF (Â§4) |
| Payments | Razorpay (default) behind a thin `PaymentProvider` interface | Checkout in UPI QR/intent mode; per-tenant keys, money settles to the client's account; optional manual-UPI bridge mode (Â§5) |
| Email | Resend + React Email | 3k/month free; delivery emails, enquiry notifications, dead-letter alerts |
| Drive automation | `googleapis` SDK + one platform service account | See Â§4 |
| Hosting | Vercel Hobby while building â†’ Vercel Pro (~â‚¹1,700/mo) or Cloudflare via OpenNext at commercial launch | **Vercel Hobby formally disallows commercial use** â€” flagged, not ignorable |

No Redis, no queue service, no search service. Reliability comes from a DB-backed outbox (Â§5), search from Postgres (Â§7).

**Why Postgres, not MongoDB or MySQL.** The domain is relational and transactional: orders â†” items â†” products â†” entitlements â†” users, money math, hard uniqueness guarantees (one entitlement per user+product, webhook event dedupe), multi-row transactions (mark paid + create jobs atomically), and admin analytics that are joins/aggregations. The search design additionally needs `pg_trgm` trigram similarity, which MySQL and vanilla MongoDB lack. Storage is a non-factor: PDFs live in Google Drive and images in Supabase Storage â€” the database holds only metadata (thousands of orders â‰ˆ a few MB), and MongoDB Atlas's free tier (512MB) is the same size as Supabase's anyway.

## 3. Tenancy model

- `tenants` table: name, custom domains, branding JSON (logo, colors, institute copy), **encrypted** Razorpay key id/secret + webhook secret, Drive root folder ID + connection status, support email, status.
- Every business table carries `tenant_id` with composite indexes.
- Next.js middleware resolves `Host` header â†’ tenant (cached) â†’ request context. MVP has one tenant row; unknown hosts fall back to the default tenant.
- A **Prisma client extension auto-injects `tenant_id`** into every query â€” isolation is systematic, not remembered per-query. Covered by unit tests.
- Onboarding tenant #2: insert row, point DNS, share Drive folder with the service account, paste Razorpay keys, verify both from the admin panel. No code, no deployment.
- Supabase RLS is not used for tenant isolation (Prisma connects with the service role); enforcement lives in the app layer and its tests.

## 4. Google Drive integration

**Connection model: service-account folder sharing, not OAuth.**
The platform owns one Google Cloud project with one service account. Client onboarding = share their notes root folder with the SA email as **Editor**; we store the folder ID and verify access. The client's account remains owner of every file.

OAuth ("connect your Google account") was rejected deliberately: permission management needs Google's *restricted* Drive scope, whose production verification requires a paid CASA security assessment; unverified apps stay in testing mode where refresh tokens expire every 7 days â€” fulfillment would silently break weekly. SA sharing has no verification burden, no token expiry, same user-facing outcome.

**Per-purchase grant.** Each note product stores a `drive_file_id`. On payment:
1. `permissions.create` â€” buyer email as `reader`, `sendNotificationEmail: false` (we send our own branded email). Returned permission ID stored on the entitlement for one-call revocation.
2. `copyRequiresWriterPermission: true` is set **once per file at product-creation time** â€” disables download/print/copy for viewers.

**Revocation:** refunds or admin override delete the stored permission ID.

**Preview generation from the source PDF.** Product previews are derived from the note's own Drive file, not uploaded by hand. On product save, a background job (same outbox mechanism as Â§5): downloads the PDF via the service account (`files.get`, `alt=media` â€” Editor access bypasses the viewer download block), rasterizes the admin-chosen pages (default: first 2â€“3) at low resolution using `pdfjs-dist` + `@napi-rs/canvas` (prebuilt binaries, serverless-safe), applies a diagonal tenant watermark with `sharp`, and stores the images in Supabase Storage. Page 1 doubles as the auto-generated cover thumbnail. Manual image upload remains as a fallback for oversized or unrenderable PDFs.

Embedding the paid file's own Drive preview iframe was rejected: the file is private (that's the product), and a separate link-public "preview copy" per product would be manual client work, unwatermarked, and a shareable leak vector â€” plus Drive iframes are slow and poor on mobile. Server-generated low-res watermarked images keep the PDP fast and yield nothing sellable if scraped.

**Constraints (client-facing expectations):**
- Buyer email must be a Google account â†’ hence mandatory Google sign-in (Â§5).
- Nothing prevents screenshots/photography. Previews are watermarked; per-buyer forensic watermarking is a possible future upgrade, out of MVP scope. This design defeats casual sharing, not determined piracy â€” the honest ceiling of Drive-based delivery.

## 5. Checkout & fulfillment pipeline

**PRD deviation (deliberate):** guest checkout is dropped. **Google sign-in is required before payment** (one tap). A typed email invites typos and non-Google addresses â€” payments that can't be fulfilled. Sign-in guarantees a valid Google identity and gives every buyer a dashboard.

**Payment modes.** The pipeline fires on "order marked paid" regardless of how it got marked, which allows two modes per tenant:
- **Gateway mode (default):** Razorpay Standard Checkout â€” for UPI buyers this is a QR scan (desktop) or UPI-app intent (mobile); the `payment.captured` webhook confirms automatically, so delivery is instant. Requires the client's one-time KYC (any RBI-licensed aggregator requires this; automated payment confirmation without KYC does not legitimately exist). Gateway calls sit behind a thin `PaymentProvider` interface so Cashfree/PhonePe/etc. can slot in per tenant later.
- **Manual UPI mode (pre-KYC launch bridge, tenant setting):** checkout shows the tenant's static UPI QR plus the order reference; the buyer submits their UPI transaction (UTR) number; the order sits in `pending_verification`; the admin cross-checks the bank app and clicks Confirm, which fires the identical fulfillment pipeline. Trade-offs accepted: delivery is not instant, fake references must be caught by the admin, and per-order manual work returns. Exists only to launch while KYC completes, then gets switched off.

Pipeline:

```
Cart â†’ Google sign-in â†’ Razorpay Checkout (per-tenant keys)
  â†’ Razorpay webhook (payment.captured)
      â†’ verify signature with tenant webhook secret
      â†’ dedupe on Razorpay event ID (webhooks retry; handler is idempotent)
      â†’ order marked paid
      â†’ one fulfillment_jobs row per order item:
          grant Drive permission â†’ create entitlement â†’ send delivery email
  â†’ success page polls order status (webhook may beat the redirect)
```

**Outbox reliability:** jobs are attempted inline right after the webhook, then a Vercel cron sweeps every minute retrying failures with backoff. Exhausted jobs dead-letter and surface in the admin panel with a manual retry button. Student dashboard shows "access being prepared" for pending items â€” a slow grant never looks like a lost payment.

**Edge cases handled:** duplicate webhooks (event-ID dedupe); user closes tab after paying (webhook still fulfills, email still arrives); Drive file deleted/moved by client (job dead-letters, admin alerted, no broken link shown); refund webhook revokes entitlements via stored permission IDs; bundle item already owned (grant skipped, entitlements unique per user+product).

## 6. Data model

All tables carry `tenant_id`. PKs/timestamps omitted.

| Table | Purpose |
|---|---|
| `tenants` | Client config (Â§3) |
| `users` | Student profile linked to Supabase Auth ID; role `student`/`admin` |
| `products` | `type` = `note` \| `bundle`; class, subject, chapter number, official NCERT title, slug, price, description, `drive_file_id`, cover/preview paths, status |
| `bundle_items` | Bundle product â†’ child note products; bundle price on the bundle row |
| `product_aliases` | Admin-editable search aliases ("Carbon", "Ch 4 Sci", â€¦) |
| `orders` / `order_items` | Buyer, totals, payment mode (gateway/manual), gateway order/payment IDs or buyer-submitted UTR, status incl. `pending_verification`; line items snapshot prices |
| `entitlements` | Access ledger: user â†” note product, Drive permission ID, granted/revoked. Unique (user, product) |
| `fulfillment_jobs` | Outbox: type (Drive grant, delivery email, preview generation), payload, attempts, next retry, last error, dead-letter flag |
| `enquiries` | Request form: type (update / new topic / issue), message, contact, admin status |
| `blog_posts` | DB-backed markdown per tenant (repo MDX can't be per-tenant or admin-edited) |
| `search_logs` | Query + result count â†’ "most searched" and "zero results" analytics |

**Bundle mechanics:** buying a bundle expands to one entitlement + one Drive grant per child note. "My Notes" shows chapters individually; refunds revoke cleanly.

## 7. Academic search

Three layers, all Postgres:
1. **Structured parsing** â€” extract class ("10", "class 10th"), subject ("sci", "sst" â†’ canonical), chapter number ("ch 4") as hard filters; residual text goes fuzzy.
2. **Trigram fuzzy match** â€” `pg_trgm` GIN index over title + aliases; "carbon compunds" still ranks *Carbon and its Compounds* first.
3. **Log every query** to `search_logs`; zero-result queries are the client's content roadmap.

PLP filters (class capsules, subject, price/popularity sort) are plain indexed queries.

## 8. Pages & UI surface

Mobile-first throughout (80%+ mobile traffic; sub-2s PLP budget).

- **Home:** hero (copy + institute/influencer image, "Shop Class 10" CTA), slim trust-stats bar, Class 9/10 capsule toggles over product grid, Instagram Reels carousel (lazy lite-embeds to protect load time), bundles strip, footer with policy pages (required for Razorpay approval).
- **PLP:** search bar, capsule filters, sort.
- **PDP:** watermarked preview gallery (auto-generated from the note's PDF, Â§4), metadata, bundle upsell widget, sticky mobile Buy button.
- **Checkout:** cart â†’ Google sign-in â†’ Razorpay checkout (UPI QR/intent) *or* manual-UPI screen (Â§5) â†’ success page with live order status.
- **Student dashboard:** My Notes grid (opens Drive in new tab), order history + invoice details, profile.
- **About + enquiry form**, **blog** (list/post, embeddable product cards), **policy pages**.

## 9. Admin panel

`/admin`, role-gated (admin role on user row, checked in middleware + every admin API route). Screens:
- Overview: revenue, orders, AOV, bundle-vs-single ratio, top searches, zero-result searches.
- Products & bundles CRUD; "verify Drive file access" button; preview generation from the Drive PDF (pick which pages, regenerate on demand) with manual image upload as fallback.
- Orders: per-item fulfillment status, manual retry, refund-with-revoke.
- Customers: purchase history, manual grant/revoke.
- Enquiry inbox; blog editor; tenant settings (branding, Razorpay keys, Drive connection check).
- Admin actions write to an audit log.

## 10. Testing

- **Vitest unit tests** where correctness is money: webhook signature verification, event dedupe/idempotency, fulfillment job state machine (mocked `googleapis`/Razorpay), search parsing + ranking, Prisma tenant-isolation extension.
- **Playwright happy path:** browse â†’ search â†’ buy (Razorpay test mode) â†’ entitlement in dashboard.
- **Manual checklist** for real Drive grants against a staging folder before launch.

## 11. Out of scope (MVP)

Coupons/affiliate codes, wishlist, ratings/reviews, per-buyer forensic watermarking, subscriptions, Class 11/12 content, mobile app, teacher dashboard (admin covers uploads for MVP), automated multi-tenant self-serve signup (tenant #2 is onboarded manually via config).

## 12. Risks

| Risk | Mitigation |
|---|---|
| Vercel Hobby commercial-use ban | Move to Pro or Cloudflare at launch; decision point, not architecture change |
| Drive API behavior changes / quota | Grants are low-volume; SA quotas generous; dead-letter + admin retry absorbs transient failures |
| Client moves/deletes Drive files | Verify-access button, dead-letter alerts, product-level re-link |
| Screenshot piracy | Expectation set with client; watermarked previews; forensic watermarking later |
| Supabase free-tier pause (7-day inactivity) | Non-issue once live traffic exists; cron pings also keep it warm |
| Client KYC delays gateway go-live | Manual UPI mode lets the store launch pre-KYC; switch to gateway mode when approved |

