export type AuthUserLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
};

export function mapAuthUser(authUser: AuthUserLike): {
  email: string;
  name: string | null;
} {
  if (!authUser.email) {
    throw new Error('Auth user has no email — Google sign-in must provide one');
  }
  const meta = authUser.user_metadata ?? {};
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null;
  return { email: authUser.email.toLowerCase(), name };
}

export function payloadToAuthUser(
  payload: Record<string, unknown>,
): AuthUserLike {
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('JWT payload has no sub claim');
  }
  return {
    id: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    user_metadata:
      payload.user_metadata && typeof payload.user_metadata === 'object'
        ? (payload.user_metadata as Record<string, unknown>)
        : undefined,
  };
}
