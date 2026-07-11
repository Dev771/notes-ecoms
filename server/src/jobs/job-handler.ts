import type { FulfillmentJob, JobType } from '@prisma/client';

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

export interface JobHandler {
  readonly type: JobType;
  handle(job: FulfillmentJob): Promise<void>;
}
