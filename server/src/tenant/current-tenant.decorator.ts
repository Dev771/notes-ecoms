import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import type { Request } from 'express';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Tenant =>
    ctx.switchToHttp().getRequest<Request & { tenant: Tenant }>().tenant,
);
