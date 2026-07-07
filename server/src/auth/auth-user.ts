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
