import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUserLike } from './auth-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserLike =>
    ctx.switchToHttp().getRequest<Request & { authUser: AuthUserLike }>()
      .authUser,
);
