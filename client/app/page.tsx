import Link from 'next/link';
import { getTenantConfig } from '@/lib/tenant-config';
import { fetchProducts } from '@/lib/catalog';
import { ProductCard } from '@/components/product-card';

export default async function HomePage() {
  const tenant = await getTenantConfig();
  // fetchProducts is resilient (client/lib/catalog.ts) — it returns [] with
  // a server-side warning rather than throwing, so a down/not-yet-wired API
  // degrades this section to "no preview grid" instead of a broken page.
  const items = (await fetchProducts({ sort: 'newest' })).slice(0, 4);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-3xl font-bold">
        Handwritten notes that make Class 9 &amp; 10 easy
      </h1>
      <p className="mt-2 text-gray-600">
        {tenant.name} — chapter-wise notes and bundles, ready to open the moment
        you pay.
      </p>
      <Link
        href="/notes"
        className="mt-6 inline-block rounded-md px-5 py-2.5 text-sm font-medium text-white"
        style={{ backgroundColor: 'var(--brand-primary)' }}
      >
        Browse all notes
      </Link>

      {items.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Newest additions</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
