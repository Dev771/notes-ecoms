'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

// Mirrors client/components/site-header.tsx's local `Me` type (kept private
// there) — GET /auth/me's response shape.
type Me = { id: string; email: string; name: string | null; role: string };

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Me>('/auth/me')
      .then((result) => {
        if (!cancelled) setMe(result);
      })
      .catch(() => {
        // No token, expired token, or a non-2xx (e.g. signed out) — treated
        // identically to "not an admin" below.
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // IMPORTANT: this is a UX-only guard, purely to avoid flashing the admin
    // shell at a signed-out or non-admin user before bouncing them home. It
    // is not what makes /admin safe — the server is the real enforcement
    // point: every request the admin pages/forms make goes through
    // AdminProductsController, which is independently gated by
    // JwtAuthGuard + RolesGuard('ADMIN') regardless of what this layout
    // decides to render.
    if (checked && me?.role !== 'ADMIN') {
      window.location.replace('/');
    }
  }, [checked, me]);

  if (!checked) {
    return <p className="p-6 text-sm text-gray-600">Checking access…</p>;
  }

  if (me?.role !== 'ADMIN') {
    // Redirect effect above is already in flight — render nothing while it
    // happens rather than flashing admin content.
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <nav className="mb-6 flex items-center gap-2 border-b pb-3 text-sm">
        <span className="font-semibold text-gray-500">Admin</span>
        <span aria-hidden="true" className="text-gray-300">
          —
        </span>
        <Link href="/admin/products" className="font-medium">
          Products
        </Link>
      </nav>
      {children}
    </div>
  );
}
