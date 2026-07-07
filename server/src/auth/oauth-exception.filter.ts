import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TenantService } from '../tenant/tenant.service';
import { verifyState } from './tokens';

/**
 * Scoped to the OAuth callback route only (`@UseFilters()` on the handler).
 *
 * The callback route can fail before the client ever gets a chance to
 * render its own `/auth/error` page (e.g. Google denies consent, the state
 * token is invalid/expired, or the nonce doesn't match this browser). Left
 * alone, Nest's default handler would return raw JSON on the API origin,
 * which the browser has no route for. This filter always redirects the
 * browser to a real `/auth/error` page instead:
 *  - if the (possibly still-decodable) state carries a `returnTo`, redirect
 *    to `/auth/error` on that origin;
 *  - otherwise fall back to `/auth/error` on the default tenant's first
 *    domain, if one is configured;
 *  - otherwise there's nowhere safe to send the browser — respond 400 JSON.
 */
@Catch()
export class OauthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OauthExceptionFilter.name);

  constructor(private readonly tenants: TenantService) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const message =
      exception instanceof Error ? exception.message : String(exception);
    this.logger.warn(`OAuth callback failed: ${message}`);

    const rawState = req.query?.state;
    const state = await verifyState(
      typeof rawState === 'string' ? rawState : '',
    ).catch(() => null);

    if (state?.returnTo) {
      res.redirect(new URL('/auth/error', state.returnTo).toString());
      return;
    }

    const defaultTenant = (await this.tenants.allActive()).find(
      (t) => t.isDefault,
    );
    const domain = defaultTenant?.domains[0];
    if (domain) {
      res.redirect(`http://${domain}/auth/error`);
      return;
    }

    res.status(400).json({
      statusCode: 400,
      message: 'OAuth sign-in failed',
    });
  }
}
