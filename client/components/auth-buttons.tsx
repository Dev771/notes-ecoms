'use client';

import { apiUrl } from '@/lib/api';
import { clearAuthToken } from '@/lib/auth-token';

export function SignInButton() {
  const signIn = () => {
    const returnTo = `${window.location.origin}/auth/callback`;
    window.location.assign(apiUrl(`/auth/google?returnTo=${encodeURIComponent(returnTo)}`));
  };
  return (
    <button onClick={signIn} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white">
      Sign in with Google
    </button>
  );
}

export function SignOutButton() {
  const signOut = () => {
    clearAuthToken();
    window.location.assign('/');
  };
  return (
    <button onClick={signOut} className="rounded-md border px-4 py-2 text-sm">
      Sign out
    </button>
  );
}
