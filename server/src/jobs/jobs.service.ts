import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { FulfillmentJob, JobType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JOB_HANDLERS, JobHandler } from './job-handler';
import { computeBackoffMs, isDead } from './job-math';

/**
 * Everything a fulfillment-job create needs EXCEPT tenantId (stamped at
 * runtime by the tenant-scoped client — see enqueue). Deriving this from the
 * generated input type keeps enqueue compile-checked against future schema
 * changes: a new required column makes the uncast assignment below error.
 */
type EnqueueData = Omit<Prisma.FulfillmentJobUncheckedCreateInput, 'tenantId'>;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<JobType, JobHandler>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(JOB_HANDLERS) handlers: JobHandler[] = [],
  ) {
    for (const h of handlers) this.handlers.set(h.type, h);
    this.logger.log(
      `Registered job handlers: [${handlers.map((h) => h.type).join(', ')}]`,
    );
  }

  async enqueue(
    tenantId: string,
    type: JobType,
    payload: object,
  ): Promise<FulfillmentJob> {
    // tenantId is intentionally absent here: the tenant-scoped client's
    // $allOperations extension (applyTenantScope) stamps it onto `data` at
    // runtime. The extension doesn't relax Prisma's generated input types to
    // reflect that, so the literal is assigned to EnqueueData uncast (a
    // future required schema field becomes a compile error right here) and
    // only the assembled value is cast at the call site to satisfy the
    // generated input type.
    const data: EnqueueData = { type, payload };
    return this.prisma.forTenant(tenantId).fulfillmentJob.create({
      data: data as Prisma.FulfillmentJobUncheckedCreateInput,
    });
  }

  /**
   * Claims and runs due PENDING jobs. Worker infrastructure: spans tenants
   * by design.
   *
   * KNOWN LIMITATION (deliberate MVP trade-off): a job flipped to RUNNING is
   * never reclaimed. If the process dies mid-handler — or the
   * failure-recording `update` in `run` itself fails — the job stays RUNNING
   * forever; there is no lease/heartbeat/TTL, so recovery is a manual status
   * reset. Intended fix: a `claimedAt` timestamp plus a reclaim-stale-RUNNING
   * sweep, targeted for Phase 3 when payment jobs arrive.
   */
  async processDueJobs(limit = 5): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const due = await this.prisma.fulfillmentJob.findFirst({
        where: { status: 'PENDING', nextRunAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
      });
      if (!due) break;
      const claimed = await this.prisma.fulfillmentJob.updateMany({
        where: { id: due.id, status: 'PENDING' },
        data: { status: 'RUNNING' },
      });
      if (claimed.count !== 1) continue; // raced; try next loop iteration
      await this.run({ ...due, status: 'RUNNING' });
      processed++;
    }
    return processed;
  }

  private async run(job: FulfillmentJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler)
        throw new Error(`No handler registered for job type ${job.type}`);
      await handler.handle(job);
      await this.prisma.fulfillmentJob.update({
        where: { id: job.id },
        data: { status: 'DONE', lastError: null },
      });
    } catch (e) {
      const attempts = job.attempts + 1;
      const dead = isDead(attempts, job.maxAttempts);
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Job ${job.id} (${job.type}) failed attempt ${attempts}: ${message}`,
      );
      await this.prisma.fulfillmentJob.update({
        where: { id: job.id },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          attempts,
          lastError: message,
          nextRunAt: new Date(Date.now() + computeBackoffMs(attempts)),
        },
      });
    }
  }
}
