import { NotFoundException } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';
import type { TenantService } from './tenant.service';

const tenant = { id: 't1', slug: 'default' };

function middlewareWith(resolved: unknown) {
  const service = {
    resolveByHost: jest.fn().mockResolvedValue(resolved),
  } as unknown as TenantService;
  return { mw: new TenantMiddleware(service), service };
}

describe('TenantMiddleware', () => {
  it('resolves from the Origin header host', async () => {
    const { mw, service } = middlewareWith(tenant);
    const req: Record<string, unknown> = {
      headers: { origin: 'https://sharmanotes.in', host: 'api.internal:3001' },
    };
    const next = jest.fn();
    await mw.use(req as never, {} as never, next);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock reference, never invoked unbound
    expect(service.resolveByHost).toHaveBeenCalledWith('sharmanotes.in');
    expect(req.tenant).toBe(tenant);
    expect(next).toHaveBeenCalled();
  });

  it('falls back to Host when Origin is absent', async () => {
    const { mw, service } = middlewareWith(tenant);
    const req: Record<string, unknown> = {
      headers: { host: 'localhost:3001' },
    };
    await mw.use(req as never, {} as never, jest.fn());
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest mock reference, never invoked unbound
    expect(service.resolveByHost).toHaveBeenCalledWith('localhost:3001');
  });

  it('throws NotFound when no tenant resolves', async () => {
    const { mw } = middlewareWith(null);
    const req = { headers: { host: 'nowhere.com' } };
    await expect(mw.use(req as never, {} as never, jest.fn())).rejects.toThrow(
      NotFoundException,
    );
  });
});
