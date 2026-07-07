import { tenantForReturnTo } from './return-to';

const tenants = [
  { slug: 'default', domains: ['localhost'] },
  { slug: 'sharma', domains: ['sharmanotes.in'] },
];

describe('tenantForReturnTo', () => {
  it('matches a tenant by returnTo host (port/www-insensitive)', () => {
    expect(
      tenantForReturnTo('http://localhost:3000/auth/callback', tenants)?.slug,
    ).toBe('default');
    expect(
      tenantForReturnTo('https://www.sharmanotes.in/auth/callback', tenants)
        ?.slug,
    ).toBe('sharma');
  });

  it('rejects hosts matching no tenant — no default fallback (open-redirect guard)', () => {
    expect(
      tenantForReturnTo('https://evil.example.com/auth/callback', tenants),
    ).toBeNull();
  });

  it('rejects non-http(s) schemes', () => {
    expect(tenantForReturnTo('javascript:alert(1)', tenants)).toBeNull();
  });

  it('rejects strings that are not URLs', () => {
    expect(tenantForReturnTo('not a url', tenants)).toBeNull();
  });
});
