import {
  signAuthToken,
  signState,
  verifyAuthToken,
  verifyState,
} from './tokens';

describe('auth tokens', () => {
  const original = process.env.AUTH_JWT_SECRET;

  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = 's'.repeat(64);
  });

  afterAll(() => {
    if (original === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = original;
  });

  it('round-trips auth claims', async () => {
    const token = await signAuthToken({
      userId: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      role: 'STUDENT',
    });
    await expect(verifyAuthToken(token)).resolves.toEqual({
      userId: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      role: 'STUDENT',
    });
  });

  it('round-trips state claims', async () => {
    const token = await signState({
      tenantId: 't1',
      returnTo: 'http://localhost:3000/auth/callback',
    });
    await expect(verifyState(token)).resolves.toEqual({
      tenantId: 't1',
      returnTo: 'http://localhost:3000/auth/callback',
    });
  });

  it('rejects tampered tokens', async () => {
    const token = await signAuthToken({
      userId: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      role: 'STUDENT',
    });
    const parts = token.split('.');
    parts[1] = parts[1].slice(0, -2) + 'xx';
    await expect(verifyAuthToken(parts.join('.'))).rejects.toThrow();
  });

  it('rejects a state token passed as an auth token', async () => {
    const state = await signState({ tenantId: 't1', returnTo: 'http://x.com' });
    await expect(verifyAuthToken(state)).rejects.toThrow(/malformed/i);
  });

  it('throws a clear error when the secret is missing or too short', async () => {
    delete process.env.AUTH_JWT_SECRET;
    await expect(
      signAuthToken({ userId: 'u', tenantId: 't', email: 'e', role: 'r' }),
    ).rejects.toThrow(/AUTH_JWT_SECRET/);
  });
});
