function normalizeHost(host: string | null): string {
  return (host ?? '')
    .toLowerCase()
    .split(':')[0]
    .replace(/^www\./, '');
}

export function pickTenantForHost<
  T extends { domains: string[]; isDefault: boolean },
>(host: string | null, tenants: T[]): T | null {
  const h = normalizeHost(host);
  const exact = tenants.find((t) =>
    t.domains.some((d) => normalizeHost(d) === h),
  );
  return exact ?? tenants.find((t) => t.isDefault) ?? null;
}
