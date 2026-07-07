import { Injectable } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickTenantForHost } from './tenant-resolver';

const CACHE_TTL_MS = 60_000;

@Injectable()
export class TenantService {
  private cache: { tenants: Tenant[]; fetchedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async activeTenants(): Promise<Tenant[]> {
    if (!this.cache || Date.now() - this.cache.fetchedAt > CACHE_TTL_MS) {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
      });
      this.cache = { tenants, fetchedAt: Date.now() };
    }
    return this.cache.tenants;
  }

  async resolveByHost(host: string | null): Promise<Tenant | null> {
    return pickTenantForHost(host, await this.activeTenants());
  }

  async allActive(): Promise<Tenant[]> {
    return this.activeTenants();
  }
}
