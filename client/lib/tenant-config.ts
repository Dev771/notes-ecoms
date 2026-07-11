import { apiServerFetch } from './api-server';

export type TenantConfig = { slug: string; name: string; branding: unknown };

const FALLBACK: TenantConfig = {
  slug: 'default',
  name: 'Notes Platform',
  branding: {},
};

export async function getTenantConfig(): Promise<TenantConfig> {
  try {
    return await apiServerFetch<TenantConfig>('/tenant/config');
  } catch {
    return FALLBACK;
  }
}
