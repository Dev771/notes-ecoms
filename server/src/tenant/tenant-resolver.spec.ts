import { pickTenantForHost } from './tenant-resolver';

const t = (slug: string, domains: string[], isDefault = false) => ({
  slug,
  domains,
  isDefault,
});

const tenants = [
  t('default', ['localhost'], true),
  t('sharma', ['sharmanotes.in', 'shop.sharmanotes.in']),
];

describe('pickTenantForHost', () => {
  it('matches an exact domain', () => {
    expect(pickTenantForHost('sharmanotes.in', tenants)?.slug).toBe('sharma');
  });

  it('ignores port and case, strips www', () => {
    expect(pickTenantForHost('WWW.SharmaNotes.in:443', tenants)?.slug).toBe(
      'sharma',
    );
    expect(pickTenantForHost('localhost:3000', tenants)?.slug).toBe('default');
  });

  it('matches subdomains listed explicitly', () => {
    expect(pickTenantForHost('shop.sharmanotes.in', tenants)?.slug).toBe(
      'sharma',
    );
  });

  it('falls back to the default tenant for unknown hosts', () => {
    expect(pickTenantForHost('unknown.example.com', tenants)?.slug).toBe(
      'default',
    );
  });

  it('returns null when nothing matches and there is no default', () => {
    expect(pickTenantForHost('x.com', [t('a', ['a.com'])])).toBeNull();
  });

  it('handles a null host', () => {
    expect(pickTenantForHost(null, tenants)?.slug).toBe('default');
  });
});
