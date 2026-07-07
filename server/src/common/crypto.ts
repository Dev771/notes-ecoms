import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const hex = process.env.SECRETS_MASTER_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('SECRETS_MASTER_KEY must be set to 64 hex characters');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(token: string): string {
  const [ivB64, tagB64, dataB64] = token.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed secret token');
  const decipher = createDecipheriv(
    ALGO,
    masterKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
