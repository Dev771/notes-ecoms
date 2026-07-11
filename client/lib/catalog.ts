import { apiServerFetch } from './api-server';

export type ProductType = 'NOTE' | 'BUNDLE';
export type Subject = 'SCIENCE' | 'MATHS' | 'SST' | 'ENGLISH';
export type ProductSort = 'newest' | 'price_asc' | 'price_desc';

/**
 * Public projection of a Product, mirroring `PublicProduct` from
 * `server/src/catalog/catalog.service.ts` (Task 8). Deliberately excludes
 * internal-only fields (status, driveFileId, raw storage paths, etc).
 */
export interface PublicProduct {
  id: string;
  type: ProductType;
  slug: string;
  title: string;
  description: string;
  classLevel: number;
  subject: Subject;
  chapterNo: number | null;
  pricePaise: number;
  coverUrl: string | null;
  previewUrls: string[];
}

/**
 * Current `/notes` query params, as read off `searchParams`. Shared shape
 * between the page, the filter/search UI, and the fetchers below so the two
 * stay in sync.
 */
export interface CatalogSearchParams {
  classLevel?: string;
  subject?: string;
  sort?: string;
  q?: string;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * `GET /products?classLevel=&subject=&sort=` — filtered/sorted catalog
 * listing. The API wraps results in `{ items }`.
 *
 * Resilient by design: the API can't serve this route yet (module wiring
 * lands with a concurrent task) and may be flaky/unreachable at any time in
 * production too, so any failure — network error, non-2xx, bad JSON — is
 * caught here and downgraded to an empty list plus a server-side warning,
 * rather than throwing and blowing up the page render.
 */
export async function fetchProducts(
  params: Omit<CatalogSearchParams, 'q'> = {},
): Promise<PublicProduct[]> {
  try {
    const { items } = await apiServerFetch<{ items: PublicProduct[] }>(
      `/products${buildQuery(params)}`,
    );
    return items;
  } catch (err) {
    console.warn('[catalog] fetchProducts failed, showing empty list:', err);
    return [];
  }
}

/**
 * `GET /search?q=` — typo-tolerant academic search. NOTE the response shape
 * differs from `/products`: a bare `PublicProduct[]`, not an `{ items }`
 * envelope. Resilient in the same way as `fetchProducts` above.
 */
export async function searchProducts(q: string): Promise<PublicProduct[]> {
  try {
    return await apiServerFetch<PublicProduct[]>(`/search${buildQuery({ q })}`);
  } catch (err) {
    console.warn('[catalog] searchProducts failed, showing empty list:', err);
    return [];
  }
}

/**
 * Full detail for a single product's PDP, mirroring `PublicProductDetail`
 * from `server/src/catalog/catalog.service.ts` (Task 8/11). `bundleItems`
 * is populated (non-empty) for a BUNDLE product — the notes it contains.
 * `inBundles` is populated for a NOTE product that's upsold inside one or
 * more bundles. Both are optional here (rather than required arrays like on
 * the server) so this type degrades gracefully if the API response ever
 * omits them.
 */
export type ProductDetail = PublicProduct & {
  bundleItems?: Array<{
    slug: string;
    title: string;
    chapterNo: number | null;
  }>;
  inBundles?: Array<{ slug: string; title: string; pricePaise: number }>;
};

/**
 * `GET /products/:slug` — full detail for the product detail page. The API
 * 404s for a missing/inactive/wrong-tenant product; that (and any other
 * failure — network error, bad JSON, etc.) is caught here and downgraded to
 * `null` plus a server-side warning, same resilience contract as
 * `fetchProducts`/`searchProducts` above. The page decides what `null`
 * means (`notFound()`).
 */
export async function fetchProduct(
  slug: string,
): Promise<ProductDetail | null> {
  try {
    return await apiServerFetch<ProductDetail>(
      `/products/${encodeURIComponent(slug)}`,
    );
  } catch (err) {
    console.warn(`[catalog] fetchProduct(${slug}) failed:`, err);
    return null;
  }
}
