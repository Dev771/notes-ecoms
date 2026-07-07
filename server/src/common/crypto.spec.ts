import { decryptSecret, encryptSecret } from './crypto';

describe('secrets crypto', () => {
  beforeEach(() => {
    process.env.SECRETS_MASTER_KEY = 'a'.repeat(64);
  });

  it('round-trips a secret', () => {
    const token = encryptSecret('rzp_test_abc123');
    expect(token).not.toContain('rzp_test_abc123');
    expect(decryptSecret(token)).toBe('rzp_test_abc123');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered ciphertext', () => {
    const parts = encryptSecret('secret').split('.');
    const flipped = Buffer.from(parts[2], 'base64');
    flipped[0] = flipped[0] ^ 0xff;
    parts[2] = flipped.toString('base64');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('throws a clear error when the master key is missing or malformed', () => {
    delete process.env.SECRETS_MASTER_KEY;
    expect(() => encryptSecret('x')).toThrow(/SECRETS_MASTER_KEY/);
    process.env.SECRETS_MASTER_KEY = 'too-short';
    expect(() => encryptSecret('x')).toThrow(/SECRETS_MASTER_KEY/);
  });
});
