import { apiFetch, apiUrl } from './api';
import { getAuthToken } from './auth-token';
import type { ProductType, Subject } from './catalog';

// Internal-only status field — deliberately not part of `PublicProduct` /
// `Subject`/`ProductType` (client/lib/catalog.ts), which mirror the public
// catalog projection. Reusing `ProductType`/`Subject` from there instead of
// redefining them (they're identical unions to the server's Prisma enums).
export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

/**
 * Mirrors `AdminProduct` in server/src/admin/admin-products.controller.ts —
 * that controller is the source of truth for this shape (read it before
 * changing this type). `aliases` is optional: the server's list/create/
 * update responses don't currently return per-product alias strings, only
 * `aliasCount` on the list projection (`AdminProductListItem` below). Every
 * read site here defaults it with `?? []`, so this degrades gracefully today
 * and would start populating for free if the controller ever adds it.
 */
export interface AdminProduct {
  id: string;
  type: ProductType;
  slug: string;
  title: string;
  description: string;
  classLevel: number;
  subject: Subject;
  chapterNo: number | null;
  pricePaise: number;
  driveFileId: string | null;
  previewPages: number[];
  status: ProductStatus;
  aliases?: string[];
  coverUrl: string | null;
  previewUrls: string[];
}

/** `GET /admin/products` item shape — adds the two list-only counts. */
export interface AdminProductListItem extends AdminProduct {
  aliasCount: number;
  bundleItemCount: number;
}

export interface CreateProductBody {
  type: ProductType;
  slug: string;
  title: string;
  description?: string;
  classLevel: number;
  subject: Subject;
  chapterNo?: number;
  pricePaise: number;
  driveFileId?: string;
  previewPages?: number[];
  status?: ProductStatus;
}

/**
 * PATCH semantics — every field optional, mirroring UpdateProductDto.
 * `chapterNo`/`driveFileId` additionally accept `null`: PATCHing an explicit
 * null CLEARS a previously-set value, while omitting the key leaves it
 * unchanged. This works because class-validator's @IsOptional skips a
 * field's validators when the value is null OR undefined (verified against
 * the installed IsOptional implementation — its skip condition is
 * `!== null && !== undefined`), so null flows through the DTO into Prisma,
 * which nulls the nullable column.
 */
export interface UpdateProductBody {
  type?: ProductType;
  slug?: string;
  title?: string;
  description?: string;
  classLevel?: number;
  subject?: Subject;
  chapterNo?: number | null;
  pricePaise?: number;
  driveFileId?: string | null;
  previewPages?: number[];
  status?: ProductStatus;
}

export interface VerifyDriveResult {
  // Literal `true`, matching the endpoint's `Promise<{ ok: true; ... }>`
  // return type — the server never sends ok:false (failures are non-2xx).
  ok: true;
  name: string;
  copyProtection: 'set' | 'owner_action_required';
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string') return m;
    // class-validator 400s carry `message: string[]` (one entry per failed
    // constraint) — join them so the admin sees every problem at once.
    if (Array.isArray(m) && m.every((x) => typeof x === 'string')) {
      return m.join('; ');
    }
  }
  return fallback;
}

/**
 * apiFetch (lib/api.ts) discards the response body on a non-2xx reply,
 * throwing a bare `API {status} on {path}` — fine for reads, but admin
 * mutations carry messages the UI must show verbatim: the delete conflict
 * ("Product has purchase history; archive it instead"), validation lists
 * (400 `message: string[]`), Drive access errors, duplicate-slug conflicts.
 * So every MUTATING wrapper below goes through this variant, which reads
 * the NestJS error body before falling back to a generic line. The one
 * read (`listAdminProducts`) stays on plain apiFetch.
 */
async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new Error(errorMessage(body, `API ${res.status} on ${path}`));
  }
  return (await res.json()) as T;
}

export function listAdminProducts(): Promise<{
  items: AdminProductListItem[];
}> {
  return apiFetch<{ items: AdminProductListItem[] }>('/admin/products');
}

export function createProduct(body: CreateProductBody): Promise<AdminProduct> {
  return adminFetch<AdminProduct>('/admin/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateProduct(
  id: string,
  body: UpdateProductBody,
): Promise<AdminProduct> {
  return adminFetch<AdminProduct>(`/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteProduct(id: string): Promise<{ ok: true }> {
  return adminFetch<{ ok: true }>(`/admin/products/${id}`, {
    method: 'DELETE',
  });
}

export function replaceAliases(
  id: string,
  aliases: string[],
): Promise<{ aliases: string[] }> {
  return adminFetch<{ aliases: string[] }>(`/admin/products/${id}/aliases`, {
    method: 'PUT',
    body: JSON.stringify({ aliases }),
  });
}

export function replaceBundleItems(
  id: string,
  noteIds: string[],
): Promise<{ noteIds: string[] }> {
  return adminFetch<{ noteIds: string[] }>(
    `/admin/products/${id}/bundle-items`,
    {
      method: 'PUT',
      body: JSON.stringify({ noteIds }),
    },
  );
}

export function verifyDrive(id: string): Promise<VerifyDriveResult> {
  return adminFetch<VerifyDriveResult>(`/admin/products/${id}/verify-drive`, {
    method: 'POST',
  });
}

export function generatePreviews(id: string): Promise<{ jobId: string }> {
  return adminFetch<{ jobId: string }>(
    `/admin/products/${id}/generate-previews`,
    { method: 'POST' },
  );
}
