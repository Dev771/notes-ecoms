import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchProduct } from '@/lib/catalog';
import type { Subject } from '@/lib/catalog';
import { PreviewGallery } from '@/components/preview-gallery';

// Not exported from `ProductCard` (kept private there), so inlined here to
// match — see client/components/product-card.tsx for the source of truth.
const SUBJECT_LABELS: Record<Subject, string> = {
  SCIENCE: 'Science',
  MATHS: 'Maths',
  SST: 'SST',
  ENGLISH: 'English',
};

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  // fetchProduct never throws (see client/lib/catalog.ts) — `null` covers a
  // missing/inactive product as well as the API being unreachable. Either
  // way the page body 404s below, so this is just a generic fallback title.
  if (!product) {
    return { title: 'Note not found' };
  }
  return {
    title: product.title,
    description: product.description,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) notFound();

  const rupees = (product.pricePaise / 100).toFixed(0);
  const bundleItems = product.bundleItems ?? [];
  const inBundles = product.inBundles ?? [];

  return (
    <>
      <main className="mx-auto max-w-6xl p-6 pb-28 md:pb-6">
        <div className="grid gap-8 md:grid-cols-2">
          <PreviewGallery urls={product.previewUrls} title={product.title} />

          <div>
            <h1 className="text-2xl font-bold">{product.title}</h1>
            <p className="mt-1 text-sm text-gray-600">
              Class {product.classLevel} • {SUBJECT_LABELS[product.subject]}
              {product.chapterNo ? ` • Ch ${product.chapterNo}` : ''}
            </p>
            <p className="mt-4 whitespace-pre-line text-gray-700">
              {product.description}
            </p>
            <p
              className="mt-6 text-2xl font-bold"
              style={{ color: 'var(--brand-primary)' }}
            >
              ₹{rupees}
            </p>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-4 w-full cursor-not-allowed rounded-md bg-gray-300 px-4 py-3 text-sm font-medium text-gray-600"
            >
              Checkout coming soon
            </button>

            {bundleItems.length > 0 ? (
              <section className="mt-8">
                <h2 className="text-lg font-semibold">What’s inside</h2>
                <ul className="mt-2 divide-y rounded-md border">
                  {bundleItems.map((item) => (
                    <li key={item.slug}>
                      <Link
                        href={`/notes/${item.slug}`}
                        className="flex items-center justify-between p-3 text-sm hover:bg-gray-50"
                      >
                        <span>{item.title}</span>
                        {item.chapterNo ? (
                          <span className="text-gray-500">
                            Ch {item.chapterNo}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {inBundles.length > 0 ? (
              <section className="mt-8 flex flex-col gap-3">
                {inBundles.map((bundle) => (
                  <Link
                    key={bundle.slug}
                    href={`/notes/${bundle.slug}`}
                    className="block rounded-lg border p-4 text-sm font-medium transition hover:shadow-md"
                    style={{ borderColor: 'var(--brand-accent)' }}
                  >
                    Get the full {bundle.title} — ₹
                    {(bundle.pricePaise / 100).toFixed(0)}
                  </Link>
                ))}
              </section>
            ) : null}
          </div>
        </div>
      </main>

      {/* Sticky mobile buy bar — mirrors the inline price/button above so
          they're reachable without scrolling back up on small screens. */}
      <div className="fixed inset-x-0 bottom-0 flex items-center justify-between border-t bg-white p-4 md:hidden">
        <span
          className="text-lg font-bold"
          style={{ color: 'var(--brand-primary)' }}
        >
          ₹{rupees}
        </span>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="cursor-not-allowed rounded-md bg-gray-300 px-6 py-2 text-sm font-medium text-gray-600"
        >
          Checkout coming soon
        </button>
      </div>
    </>
  );
}
