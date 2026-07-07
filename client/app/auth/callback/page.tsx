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
      router.replace('/');
    } else {
      router.replace('/auth/error');
    }
  }, [router]);

  return <main className="p-8 text-center text-sm text-gray-600">Signing you in…</main>;
}
