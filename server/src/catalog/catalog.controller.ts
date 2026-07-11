import { Controller, Get, Param, Query } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { CurrentTenant } from '../tenant/current-tenant.decorator';
import { CatalogService } from './catalog.service';
import type { PublicProduct, PublicProductDetail } from './catalog.service';
import { ListProductsDto } from './dto/list-products.dto';

/**
 * Public storefront catalog — no auth guard. Tenant resolution still
 * happens (TenantMiddleware runs for every route except the health/auth
 * exclusions in AppModule), so `@CurrentTenant()` is populated as usual.
 */
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async list(
    @CurrentTenant() tenant: Tenant,
    @Query() dto: ListProductsDto,
  ): Promise<{ items: PublicProduct[] }> {
    return { items: await this.catalog.list(tenant.id, dto) };
  }

  @Get(':slug')
  async bySlug(
    @CurrentTenant() tenant: Tenant,
    @Param('slug') slug: string,
  ): Promise<PublicProductDetail> {
    return this.catalog.bySlug(tenant.id, slug);
  }
}
