import { Controller, Get } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { CurrentTenant } from './current-tenant.decorator';

@Controller('tenant')
export class TenantController {
  @Get('config')
  config(@CurrentTenant() tenant: Tenant) {
    return { slug: tenant.slug, name: tenant.name, branding: tenant.branding };
  }
}
