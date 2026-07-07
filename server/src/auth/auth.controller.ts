import { Controller, Post, UseGuards } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import { UsersService } from '../users/users.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthUserLike } from './auth-user';

@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  @Post('sync')
  @UseGuards(SupabaseAuthGuard)
  async sync(
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() authUser: AuthUserLike,
  ) {
    const user = await this.users.ensureUserRecord(tenant.id, authUser);
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
