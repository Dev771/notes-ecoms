import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyTenantScope } from './tenant-scope';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private tenantClients = new Map<
    string,
    ReturnType<PrismaService['buildTenantClient']>
  >();

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private buildTenantClient(tenantId: string) {
    return this.$extends({
      name: `tenant-${tenantId}`,
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            // Prisma's generic arg types can't express the injection; the pure
            // function is unit-tested, so the cast is contained here.
            return query(applyTenantScope(model, operation, args, tenantId));
          },
        },
      },
    });
  }

  forTenant(tenantId: string) {
    let client = this.tenantClients.get(tenantId);
    if (!client) {
      client = this.buildTenantClient(tenantId);
      this.tenantClients.set(tenantId, client);
    }
    return client;
  }
}
