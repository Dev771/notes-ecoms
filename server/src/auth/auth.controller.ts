import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { UsersService } from '../users/users.service';
import type { AuthUserLike } from './auth-user';
import { CurrentUserClaims } from './current-user.decorator';
import { GoogleOAuthGuard } from './google-oauth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OauthExceptionFilter } from './oauth-exception.filter';
import { tenantForReturnTo } from './return-to';
import { signAuthToken, signState, verifyState } from './tokens';
import type { AuthTokenClaims } from './tokens';

const OAUTH_NONCE_COOKIE = 'oauth_nonce';

/**
 * Tiny cookie-value reader — avoids pulling in cookie-parser for a single
 * cookie. Not a general-purpose parser (no quoted-value or attribute
 * handling); only fit for reading `req.headers.cookie` on incoming requests.
 */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly tenants: TenantService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('google')
  async start(
    @Query('returnTo') returnTo = '',
    @Res() res: Response,
  ): Promise<void> {
    const tenant = tenantForReturnTo(returnTo, await this.tenants.allActive());
    if (!tenant)
      throw new BadRequestException(
        'returnTo does not match any tenant domain',
      );

    // Strip any fragment — it would otherwise ride along into the signed
    // state and back out again unused (the callback appends its own
    // #token= fragment onto returnTo).
    const u = new URL(returnTo);
    u.hash = '';
    returnTo = u.toString();

    // Bind the state token to this browser session (login-CSRF defense):
    // a nonce is stored in an httpOnly cookie now and re-checked against
    // the state's nonce claim at the callback.
    const nonce = randomBytes(16).toString('hex');
    res.cookie(OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600_000,
      path: '/auth',
    });

    const state = await signState({ tenantId: tenant.id, returnTo, nonce });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? 'unconfigured',
      redirect_uri:
        process.env.GOOGLE_CALLBACK_URL ??
        'http://localhost:3001/auth/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    res.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @UseFilters(OauthExceptionFilter)
  async callback(
    @Req() req: Request & { user: AuthUserLike },
    @Res() res: Response,
  ): Promise<void> {
    const rawState = req.query.state;
    const state = await verifyState(
      typeof rawState === 'string' ? rawState : '',
    ).catch(() => null);
    if (!state) throw new BadRequestException('Invalid or expired OAuth state');

    const cookieNonce = readCookie(req.headers.cookie, OAUTH_NONCE_COOKIE);
    if (!cookieNonce || cookieNonce !== state.nonce) {
      throw new BadRequestException(
        'OAuth state does not match this browser session',
      );
    }

    const user = await this.users.ensureUserRecord(state.tenantId, req.user);
    const token = await signAuthToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });
    res.clearCookie(OAUTH_NONCE_COOKIE, { path: '/auth' });
    res.redirect(`${state.returnTo}#token=${token}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUserClaims() claims: AuthTokenClaims) {
    const user = await this.prisma.forTenant(claims.tenantId).user.findUnique({
      where: { id: claims.userId, tenantId: claims.tenantId },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
