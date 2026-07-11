import type { FulfillmentJob, JobType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { JobHandler } from './job-handler';
import { JobsService } from './jobs.service';
import { computeBackoffMs } from './job-math';

const TOLERANCE_MS = 1_000;

function baseJob(overrides: Partial<FulfillmentJob> = {}): FulfillmentJob {
  return {
    id: 'job-1',
    tenantId: 't1',
    type: 'DRIVE_GRANT',
    payload: {},
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 5,
    nextRunAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockPrisma() {
  const fulfillmentJob = {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  return {
    fulfillmentJob,
    asService: { fulfillmentJob } as unknown as PrismaService,
  };
}

function fakeHandler(type: JobType, handle: jest.Mock): JobHandler {
  return { type, handle };
}

interface UpdateCall {
  where: { id: string };
  data: {
    status: string;
    lastError?: string | null;
    attempts?: number;
    nextRunAt?: Date;
  };
}

/** Type-safe accessor for the most recent `fulfillmentJob.update(...)` call args. */
function lastUpdateCall(
  fulfillmentJob: ReturnType<typeof mockPrisma>['fulfillmentJob'],
): UpdateCall {
  const calls = fulfillmentJob.update.mock.calls as unknown as UpdateCall[][];
  return calls[0][0];
}

describe('JobsService#processDueJobs', () => {
  it('(a) marks a handled job DONE and clears lastError', async () => {
    const job = baseJob({ type: 'DRIVE_GRANT' });
    const { fulfillmentJob, asService } = mockPrisma();
    fulfillmentJob.findFirst.mockResolvedValue(job);
    fulfillmentJob.updateMany.mockResolvedValue({ count: 1 });
    fulfillmentJob.update.mockResolvedValue(job);
    const handle = jest.fn().mockResolvedValue(undefined);
    const service = new JobsService(asService, [
      fakeHandler('DRIVE_GRANT', handle),
    ]);

    const processed = await service.processDueJobs(1);

    expect(processed).toBe(1);
    expect(handle).toHaveBeenCalledWith({ ...job, status: 'RUNNING' });
    expect(fulfillmentJob.update).toHaveBeenCalledWith({
      where: { id: job.id },
      data: { status: 'DONE', lastError: null },
    });
  });

  it('(b) re-schedules a throwing handler with attempts+1, PENDING, a future nextRunAt, and lastError set', async () => {
    const job = baseJob({
      type: 'DELIVERY_EMAIL',
      attempts: 0,
      maxAttempts: 5,
    });
    const { fulfillmentJob, asService } = mockPrisma();
    fulfillmentJob.findFirst.mockResolvedValue(job);
    fulfillmentJob.updateMany.mockResolvedValue({ count: 1 });
    fulfillmentJob.update.mockResolvedValue(job);
    const handle = jest.fn().mockRejectedValue(new Error('smtp down'));
    const service = new JobsService(asService, [
      fakeHandler('DELIVERY_EMAIL', handle),
    ]);

    const before = Date.now();
    const processed = await service.processDueJobs(1);
    const after = Date.now();

    expect(processed).toBe(1);
    expect(fulfillmentJob.update).toHaveBeenCalledTimes(1);
    const arg = lastUpdateCall(fulfillmentJob);
    expect(arg.where).toEqual({ id: job.id });
    expect(arg.data.status).toBe('PENDING');
    expect(arg.data.attempts).toBe(1);
    expect(arg.data.lastError).toBe('smtp down');
    const expectedBackoff = computeBackoffMs(1);
    const nextRunAtMs = (arg.data.nextRunAt as Date).getTime();
    expect(nextRunAtMs).toBeGreaterThanOrEqual(
      before + expectedBackoff - TOLERANCE_MS,
    );
    expect(nextRunAtMs).toBeLessThanOrEqual(
      after + expectedBackoff + TOLERANCE_MS,
    );
  });

  it('(c) marks a job DEAD once attempts reach maxAttempts', async () => {
    const job = baseJob({
      type: 'PREVIEW_GENERATION',
      attempts: 4,
      maxAttempts: 5,
    });
    const { fulfillmentJob, asService } = mockPrisma();
    fulfillmentJob.findFirst.mockResolvedValue(job);
    fulfillmentJob.updateMany.mockResolvedValue({ count: 1 });
    fulfillmentJob.update.mockResolvedValue(job);
    const handle = jest.fn().mockRejectedValue(new Error('render failed'));
    const service = new JobsService(asService, [
      fakeHandler('PREVIEW_GENERATION', handle),
    ]);

    const before = Date.now();
    const processed = await service.processDueJobs(1);
    const after = Date.now();

    expect(processed).toBe(1);
    const arg = lastUpdateCall(fulfillmentJob);
    expect(arg.data.status).toBe('DEAD');
    expect(arg.data.attempts).toBe(5);
    expect(arg.data.lastError).toBe('render failed');
    const expectedBackoff = computeBackoffMs(5);
    const nextRunAtMs = (arg.data.nextRunAt as Date).getTime();
    expect(nextRunAtMs).toBeGreaterThanOrEqual(
      before + expectedBackoff - TOLERANCE_MS,
    );
    expect(nextRunAtMs).toBeLessThanOrEqual(
      after + expectedBackoff + TOLERANCE_MS,
    );
  });

  it('(d) treats an unregistered job type as a normal failure instead of crashing', async () => {
    const job = baseJob({
      type: 'PREVIEW_GENERATION',
      attempts: 0,
      maxAttempts: 5,
    });
    const { fulfillmentJob, asService } = mockPrisma();
    fulfillmentJob.findFirst.mockResolvedValue(job);
    fulfillmentJob.updateMany.mockResolvedValue({ count: 1 });
    fulfillmentJob.update.mockResolvedValue(job);
    const service = new JobsService(asService, []); // no handlers registered

    await expect(service.processDueJobs(1)).resolves.toBe(1);

    const arg = lastUpdateCall(fulfillmentJob);
    expect(arg.data.status).toBe('PENDING');
    expect(arg.data.attempts).toBe(1);
    expect(arg.data.lastError).toBe(
      'No handler registered for job type PREVIEW_GENERATION',
    );
  });

  it('(e) skips a job without running its handler when the claim is lost to a race', async () => {
    const job = baseJob({ type: 'DRIVE_GRANT' });
    const { fulfillmentJob, asService } = mockPrisma();
    fulfillmentJob.findFirst.mockResolvedValue(job);
    fulfillmentJob.updateMany.mockResolvedValue({ count: 0 }); // another worker won the race
    const handle = jest.fn();
    const service = new JobsService(asService, [
      fakeHandler('DRIVE_GRANT', handle),
    ]);

    const processed = await service.processDueJobs(1);

    expect(processed).toBe(0);
    expect(handle).not.toHaveBeenCalled();
    expect(fulfillmentJob.update).not.toHaveBeenCalled();
  });
});
