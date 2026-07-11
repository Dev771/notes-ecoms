import { fetchProducts, searchProducts } from '@/lib/catalog';
import type { CatalogSearchParams } from '@/lib/catalog';
import { ProductCard } from '@/components/product-card';
import { CatalogFilters } from '@/components/catalog-filters';

// Next's real searchParams shape allows `string[]` for repeated keys (e.g.
// `?subject=A&subject=B`); we only ever care about the first value for any
// of our params, so `first()` below normalizes down to plain strings once,
// here, and everything downstream (fetchers, filters, the result count)
// works with simple `string | undefined`.
type RawSearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const params: CatalogSearchParams = {
    classLevel: first(raw.classLevel),
    subject: first(raw.subject),
    sort: first(raw.sort),
    q: first(raw.q),
  };
  const q = params.q?.trim();
  // fetchProducts/searchProducts are resilient (see client/lib/catalog.ts):
  // they never throw, and fall back to [] with a server-side console.warn if
  // the API is down or the request fails — so this render always has a
  // (possibly empty) list to work with, never an uncaught error.
  const items = q
    ? await searchProducts(q)
    : await fetchProducts({
        classLevel: params.classLevel,
        subject: params.subject,
        sort: params.sort,
      });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">Browse Notes</h1>
      <CatalogFilters current={params} />
      {q ? (
        <p className="mt-2 text-sm text-gray-600">
          {items.length} result(s) for “{q}”
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-8 text-gray-600">
          Nothing found. Try a chapter name like “carbon” or “real numbers” — or
          tell us what you need on the enquiry page (coming soon).
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
