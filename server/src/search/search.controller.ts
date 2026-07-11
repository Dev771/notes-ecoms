import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import type { PublicProduct } from '../catalog/catalog.service';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import { SearchService } from './search.service';

/**
 * Public academic search — no auth guard (mirrors CatalogController). Tenant
 * resolution still happens (TenantMiddleware runs for every route except the
 * health/auth exclusions in AppModule), so `@CurrentTenant()` is populated
 * as usual.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  // Cross-task contract: `GET /search` returns a BARE array — the client's
  // `searchProducts` (client/lib/catalog.ts) does no unwrapping. Only
  // `GET /products` uses the `{ items }` envelope.
  @Get()
  async search(
    @CurrentTenant() tenant: Tenant,
    @Query('q') q?: string,
  ): Promise<PublicProduct[]> {
    if (!q || q.trim().length === 0) {
      throw new BadRequestException('q is required');
    }
    return this.searchService.search(tenant.id, q);
  }
}
