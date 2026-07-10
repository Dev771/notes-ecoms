import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TenantService } from '../tenant/tenant.service';
import { OauthExceptionFilter } from './oauth-exception.filter';
import { signState } from './tokens';

function mockResponse() {
  const res = {
    redirect: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function hostWith(query: Record<string, unknown>, res: unknown): ArgumentsHost {
  const req = { query } as unknown as Request;
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
}

function tenantsWith(
  tenants: Array<{ isDefault: boolean; domains: string[] }>,
) {
  return {
    allActive: jest.fn().mockResolvedValue(tenants),
  } as unknown as TenantService;
}

describe('OauthExceptionFilter', () => {
  const original = process.env.AUTH_JWT_SECRET;

  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = 's'.repeat(64);
  });

  afterAll(() => {
    if (original === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = original;
  });

  it('redirects to /auth/error on the state returnTo origin when the state is valid', async () => {
    const state = {
      tenantId: 't1',
      returnTo: 'http://localhost:3000/auth/callback',
      nonce: 'n1',
    };
    const token = await signState(state);
    const filter = new OauthExceptionFilter(tenantsWith([]));
    const res = mockResponse();

    await filter.catch(new Error('boom'), hostWith({ state: token }, res));

    expect(res.redirect).toHaveBeenCalledWith(
      new URL('/auth/error', state.returnTo).toString(),
    );
    expect(res.status).not.toHaveBeenCalled();
  });

  it('falls back to the default tenant domain when the state is garbage/absent', async () => {
    const filter = new OauthExceptionFilter(
      tenantsWith([{ isDefault: true, domains: ['sharmanotes.in'] }]),
    );
    const res = mockResponse();

    await filter.catch(new Error('boom'), hostWith({ state: 'garbage' }, res));

    expect(res.redirect).toHaveBeenCalledWith(
      'http://sharmanotes.in/auth/error',
    );
  });

  it('responds 400 JSON when the state is garbage and there is no default tenant', async () => {
    const filter = new OauthExceptionFilter(tenantsWith([]));
    const res = mockResponse();

    await filter.catch(new Error('boom'), hostWith({}, res));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
