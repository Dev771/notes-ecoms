import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  Res,
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
import { tenantForReturnTo } from './return-to';
import { signAuthToken, signState, verifyState } from './tokens';
import type { AuthTokenClaims } from './tokens';

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
    const state = await signState({ tenantId: tenant.id, returnTo });
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
  async callback(
    @Req() req: Request & { user: AuthUserLike },
    @Res() res: Response,
  ): Promise<void> {
    const rawState = req.query.state;
    const state = await verifyState(
      typeof rawState === 'string' ? rawState : '',
    ).catch(() => null);
    if (!state) throw new BadRequestException('Invalid or expired OAuth state');
    const user = await this.users.ensureUserRecord(state.tenantId, req.user);
    const token = await signAuthToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });
    res.redirect(`${state.returnTo}#token=${token}`);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUserClaims() claims: AuthTokenClaims) {
    const user = await this.prisma.forTenant(claims.tenantId).user.findUnique({
      where: { id: claims.userId, tenantId: claims.tenantId },
    });
    if (!user) throw new BadRequestException('User no longer exists');
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
