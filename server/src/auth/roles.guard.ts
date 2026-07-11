import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '@prisma/client';
import type { AuthTokenClaims } from './tokens';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { authClaims?: AuthTokenClaims }>();
    const claims = req.authClaims;
    // Defense in depth: JwtAuthGuard runs first in practice (it's always
    // paired via @UseGuards(JwtAuthGuard, RolesGuard)) and populates
    // authClaims — but this guard must not silently allow access if it's
    // ever reached without that having happened.
    if (!claims || !required.includes(claims.role as Role)) {
      throw new ForbiddenException('Insufficient role for this resource');
    }
    return true;
  }
}
