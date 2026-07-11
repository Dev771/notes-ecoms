import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantService } from './tenant.service';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const forwarded = req.headers['x-tenant-host'];
    let host: string | null =
      typeof forwarded === 'string' && forwarded.length > 0 ? forwarded : null;
    if (!host) {
      const origin = req.headers.origin;
      if (typeof origin === 'string') {
        try {
          host = new URL(origin).host;
        } catch {
          host = null;
        }
      }
    }
    host = host ?? req.headers.host ?? null;
    const tenant = await this.tenants.resolveByHost(host);
    if (!tenant)
      throw new NotFoundException(`No tenant configured for host "${host}"`);
    (req as Request & { tenant: unknown }).tenant = tenant;
    next();
  }
}
