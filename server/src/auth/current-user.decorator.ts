import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthTokenClaims } from './tokens';

export const CurrentUserClaims = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthTokenClaims =>
    ctx.switchToHttp().getRequest<Request & { authClaims: AuthTokenClaims }>()
      .authClaims,
);
