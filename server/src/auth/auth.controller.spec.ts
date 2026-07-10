import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantService } from '../tenant/tenant.service';
import type { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import type { AuthUserLike } from './auth-user';
import { signState } from './tokens';

const TENANT_ID = 't1';
const RETURN_TO = 'http://localhost:3000/auth/callback';
const NONCE = 'correct-nonce';
const AUTH_USER: AuthUserLike = { id: 'g1', email: 'kid@gmail.com' };

function mockUsers() {
  const users = {
    ensureUserRecord: jest.fn().mockResolvedValue({
      id: 'u1',
      tenantId: TENANT_ID,
      email: 'kid@gmail.com',
      role: 'STUDENT',
    }),
  };
  return { users, service: users as unknown as UsersService };
}

function mockResponse() {
  return {
    redirect: jest.fn(),
    clearCookie: jest.fn(),
  };
}

function requestWith(
  state: string,
  cookieHeader: string | undefined,
): Request & { user: AuthUserLike } {
  return {
    query: { state },
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
    user: AUTH_USER,
  } as unknown as Request & { user: AuthUserLike };
}

function controllerWith(users: UsersService): AuthController {
  return new AuthController(
    {} as unknown as TenantService,
    users,
    {} as unknown as PrismaService,
  );
}

describe('AuthController#callback — nonce binding', () => {
  const original = process.env.AUTH_JWT_SECRET;

  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = 's'.repeat(64);
  });

  afterAll(() => {
    if (original === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = original;
  });

  it('rejects the callback when no oauth_nonce cookie is present', async () => {
    const state = await signState({
      tenantId: TENANT_ID,
      returnTo: RETURN_TO,
      nonce: NONCE,
    });
    const { users, service } = mockUsers();
    const controller = controllerWith(service);
    const req = requestWith(state, undefined);
    const res = mockResponse();

    await expect(
      controller.callback(req, res as unknown as Response),
    ).rejects.toThrow(BadRequestException);
    expect(users.ensureUserRecord).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('rejects the callback when the cookie nonce does not match the state nonce', async () => {
    const state = await signState({
      tenantId: TENANT_ID,
      returnTo: RETURN_TO,
      nonce: NONCE,
    });
    const { users, service } = mockUsers();
    const controller = controllerWith(service);
    const req = requestWith(state, 'oauth_nonce=wrong-nonce');
    const res = mockResponse();

    await expect(
      controller.callback(req, res as unknown as Response),
    ).rejects.toThrow(BadRequestException);
    expect(users.ensureUserRecord).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('completes sign-in when the cookie nonce matches the state nonce', async () => {
    const state = await signState({
      tenantId: TENANT_ID,
      returnTo: RETURN_TO,
      nonce: NONCE,
    });
    const { users, service } = mockUsers();
    const controller = controllerWith(service);
    const req = requestWith(state, `oauth_nonce=${NONCE}`);
    const res = mockResponse();

    await controller.callback(req, res as unknown as Response);

    expect(users.ensureUserRecord).toHaveBeenCalledWith(TENANT_ID, AUTH_USER);
    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining(`${RETURN_TO}#token=`),
    );
    expect(res.clearCookie).toHaveBeenCalledWith('oauth_nonce', {
      path: '/auth',
    });
  });
});
