import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUserLike, mapAuthUser } from '../auth/auth-user';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureUserRecord(
    tenantId: string,
    authUser: AuthUserLike,
  ): Promise<User> {
    const { email, name } = mapAuthUser(authUser);
    const db = this.prisma.forTenant(tenantId);
    return db.user.upsert({
      where: { tenantId_authId: { tenantId, authId: authUser.id } },
      // tenantId is also injected by the tenant-scope Prisma extension at
      // runtime; it's supplied here too so the literal satisfies Prisma's
      // UserUncheckedCreateInput at compile time (harmless — same value).
      create: { tenantId, authId: authUser.id, email, name },
      update: { email, name },
    });
  }
}
