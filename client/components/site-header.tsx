'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAuthToken } from '@/lib/auth-token';
import { SignInButton, SignOutButton } from '@/components/auth-buttons';

type Me = { id: string; email: string; name: string | null; role: string };

export function SiteHeader({ tenantName }: { tenantName: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const displayName = me?.name ?? me?.email ?? null;

  useEffect(() => {
    if (!getAuthToken()) return;
    apiFetch<Me>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
        <Link
          href="/"
          className="text-lg font-bold"
          style={{ color: 'var(--brand-primary)' }}
        >
          {tenantName}
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/notes" className="text-sm font-medium text-gray-700">
            Browse Notes
          </Link>
          {displayName ? (
            <>
              <span className="text-sm text-gray-600">{displayName}</span>
              <SignOutButton />
            </>
          ) : (
            <SignInButton />
          )}
        </nav>
      </div>
    </header>
  );
}
