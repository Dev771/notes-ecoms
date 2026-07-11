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
