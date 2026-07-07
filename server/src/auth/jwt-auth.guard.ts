import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Tenant } from '@prisma/client';
import { AuthTokenClaims, verifyAuthToken } from './tokens';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<
        Request & { tenant?: Tenant; authClaims?: AuthTokenClaims }
      >();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing bearer token');
    let claims: AuthTokenClaims;
    try {
      claims = await verifyAuthToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (req.tenant && req.tenant.id !== claims.tenantId) {
      throw new UnauthorizedException('Token does not belong to this tenant');
    }
    req.authClaims = claims;
    return true;
  }
}
