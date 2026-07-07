function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .split(':')[0]
    .replace(/^www\./, '');
}

/**
 * Allow-list validation for OAuth returnTo targets: the host must exactly
 * match an active tenant's domain. Deliberately NO isDefault fallback —
 * falling back would let any URL redirect through us (open redirect).
 */
export function tenantForReturnTo<T extends { domains: string[] }>(
  returnTo: string,
  tenants: T[],
): T | null {
  let host: string;
  try {
    const url = new URL(returnTo);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    host = url.host;
  } catch {
    return null;
  }
  const h = normalizeHost(host);
  return (
    tenants.find((t) => t.domains.some((d) => normalizeHost(d) === h)) ?? null
  );
}
