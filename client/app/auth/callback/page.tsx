'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setAuthToken } from '@/lib/auth-token';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hash.get('token');
    if (token) {
      setAuthToken(token);
      // Hard navigation: remounts the layout so the header picks up the
      // token immediately, and scrubs the token-bearing URL from history.
      window.location.replace('/');
    } else {
      router.replace('/auth/error');
    }
  }, [router]);

  return (
    <main className="p-8 text-center text-sm text-gray-600">
      Signing you in…
    </main>
  );
}
