import { Injectable } from '@nestjs/common';
import type { FulfillmentJob } from '@prisma/client';
import { JobHandler } from '../jobs/job-handler';
import { PreviewService } from './preview.service';

@Injectable()
export class PreviewGenerationHandler implements JobHandler {
  readonly type = 'PREVIEW_GENERATION' as const;

  constructor(private readonly previews: PreviewService) {}

  async handle(job: FulfillmentJob): Promise<void> {
    const payload = job.payload as { productId?: string };
    if (!payload.productId)
      throw new Error('PREVIEW_GENERATION payload missing productId');
    await this.previews.generateForProduct(job.tenantId, payload.productId);
  }
}
