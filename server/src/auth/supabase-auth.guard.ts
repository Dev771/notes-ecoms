import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request } from 'express';
import { payloadToAuthUser } from './auth-user';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  private getJwks() {
    if (!this.jwks) {
      const base = process.env.SUPABASE_URL;
      if (!base) throw new Error('SUPABASE_URL is not set');
      this.jwks = createRemoteJWKSet(
        new URL(`${base}/auth/v1/.well-known/jwks.json`),
      );
    }
    return this.jwks;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { authUser?: unknown }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Missing bearer token');
    try {
      const { payload } = await jwtVerify(token, this.getJwks());
      req.authUser = payloadToAuthUser(payload);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
