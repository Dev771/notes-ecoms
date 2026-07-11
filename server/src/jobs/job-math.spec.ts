import { computeBackoffMs, isDead } from './job-math';

describe('job math', () => {
  it('doubles backoff per attempt from a 30s base', () => {
    expect(computeBackoffMs(0)).toBe(30_000);
    expect(computeBackoffMs(1)).toBe(60_000);
    expect(computeBackoffMs(3)).toBe(240_000);
  });

  it('caps backoff at one hour', () => {
    expect(computeBackoffMs(20)).toBe(3_600_000);
  });

  it('declares a job dead once attempts reach maxAttempts', () => {
    expect(isDead(4, 5)).toBe(false);
    expect(isDead(5, 5)).toBe(true);
    expect(isDead(6, 5)).toBe(true);
  });
});
