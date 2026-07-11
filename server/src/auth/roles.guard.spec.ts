import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

/**
 * RolesGuard's own decision logic is what's under test here — not
 * Reflector's correctness (that's Nest's job). So Reflector is mocked
 * directly to return whatever `@Roles(...)` metadata a case needs, rather
 * than wiring up real decorated dummy classes.
 */
function reflectorReturning(roles: Role[] | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  } as unknown as Reflector;
}

function contextWithClaims(authClaims?: { role: string }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ authClaims }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('(a) allows the request when no @Roles metadata is present on the route', () => {
    const guard = new RolesGuard(reflectorReturning(undefined));
    const ctx = contextWithClaims({ role: 'STUDENT' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('(b) allows the request when claims.role is among the required roles', () => {
    const guard = new RolesGuard(reflectorReturning(['ADMIN']));
    const ctx = contextWithClaims({ role: 'ADMIN' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('(c) throws ForbiddenException when claims.role does not match any required role', () => {
    const guard = new RolesGuard(reflectorReturning(['ADMIN']));
    const ctx = contextWithClaims({ role: 'STUDENT' });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('(d) throws ForbiddenException when authClaims is missing entirely — defense in depth, JwtAuthGuard should have run first', () => {
    const guard = new RolesGuard(reflectorReturning(['ADMIN']));
    const ctx = contextWithClaims(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
