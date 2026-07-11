const BASE_MS = 30_000;
const CAP_MS = 3_600_000;

export function computeBackoffMs(attempts: number): number {
  return Math.min(BASE_MS * 2 ** attempts, CAP_MS);
}

export function isDead(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}
