import { SignJWT, jwtVerify } from 'jose';

export type AuthTokenClaims = {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
};

export type StateClaims = {
  tenantId: string;
  returnTo: string;
};

function secret(): Uint8Array {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('AUTH_JWT_SECRET must be set to at least 32 characters');
  }
  return new TextEncoder().encode(s);
}

async function sign(
  payload: Record<string, string>,
  expiry: string,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(secret());
}

export async function signAuthToken(claims: AuthTokenClaims): Promise<string> {
  return sign({ ...claims, kind: 'auth' }, '7d');
}

export async function verifyAuthToken(token: string): Promise<AuthTokenClaims> {
  const { payload } = await jwtVerify(token, secret());
  if (
    payload.kind !== 'auth' ||
    typeof payload.userId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.role !== 'string'
  ) {
    throw new Error('Malformed auth token');
  }
  return {
    userId: payload.userId,
    tenantId: payload.tenantId,
    email: payload.email,
    role: payload.role,
  };
}

export async function signState(claims: StateClaims): Promise<string> {
  return sign({ ...claims, kind: 'state' }, '10m');
}

export async function verifyState(token: string): Promise<StateClaims> {
  const { payload } = await jwtVerify(token, secret());
  if (
    payload.kind !== 'state' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.returnTo !== 'string'
  ) {
    throw new Error('Malformed state token');
  }
  return { tenantId: payload.tenantId, returnTo: payload.returnTo };
}
