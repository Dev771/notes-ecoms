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
            // The pure, unit-tested applyTenantScope transforms args
            // (injecting/stamping tenantId) before the query executes.
            return query(applyTenantScope(model, operation, args, tenantId));
          },
        },
      },
    });
  }

  /**
   * Returns the memoized tenant-scoped client — the ONLY sanctioned handle
   * for business queries.
   *
   * BOUNDARY WARNING: the extension intercepts model operations only.
   * `$queryRaw` / `$executeRaw` are NOT scoped, and nested relational writes
   * (e.g. `data: { relation: { create: {...} } }`) are NOT stamped — only
   * top-level `where` / `data` / `create` are. Scope those manually.
   */
  forTenant(tenantId: string) {
    let client = this.tenantClients.get(tenantId);
    if (!client) {
      client = this.buildTenantClient(tenantId);
      this.tenantClients.set(tenantId, client);
    }
    return client;
  }
}
