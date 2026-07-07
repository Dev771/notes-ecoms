export type TenantConfig = { slug: string; name: string; branding: unknown };

const FALLBACK: TenantConfig = {
  slug: 'default',
  name: 'Notes Platform',
  branding: {},
};

export async function getTenantConfig(): Promise<TenantConfig> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${base}/tenant/config`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return FALLBACK;
    return (await res.json()) as TenantConfig;
  } catch {
    return FALLBACK;
  }
}
