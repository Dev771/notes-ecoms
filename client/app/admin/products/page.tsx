'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  deleteProduct,
  listAdminProducts,
  type AdminProductListItem,
} from '@/lib/admin-api';
import type { Subject } from '@/lib/catalog';

// Mirrors client/components/product-card.tsx's SUBJECT_LABELS (kept private
// there).
const SUBJECT_LABELS: Record<Subject, string> = {
  SCIENCE: 'Science',
  MATHS: 'Maths',
  SST: 'SST',
  ENGLISH: 'English',
};

export default function AdminProductsPage() {
  const [items, setItems] = useState<AdminProductListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Inlined directly in the effect (rather than calling a shared named
  // function) so the fetch-then-setState flow stays in one place per
  // react-hooks/set-state-in-effect — same pattern as
  // components/admin/product-form.tsx's load effect.
  useEffect(() => {
    let cancelled = false;
    listAdminProducts()
      .then(({ items }) => {
        if (!cancelled) setItems(items);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : 'Failed to load products',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    try {
      const { items } = await listAdminProducts();
      setItems(items);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load products');
    }
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeleteError(null);
    setPendingDeleteId(id);
    try {
      await deleteProduct(id);
      await refresh();
    } catch (e) {
      // deleteProduct (lib/admin-api.ts) surfaces the API's own message for
      // a 409 (e.g. "Product has purchase history; archive it instead").
      setDeleteError(
        e instanceof Error ? e.message : 'Failed to delete product',
      );
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Products</h1>
        <Link
          href="/admin/products/new"
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--brand-primary)' }}
        >
          New product
        </Link>
      </div>

      {loadError ? (
        <p className="mb-4 text-sm text-red-600">{loadError}</p>
      ) : null}
      {deleteError ? (
        <p className="mb-4 text-sm text-red-600">{deleteError}</p>
      ) : null}

      {items === null ? (
        <p className="text-sm text-gray-600">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-600">No products yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="p-3 font-medium">Title</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Class</th>
                <th className="p-3 font-medium">Subject</th>
                <th className="p-3 font-medium">₹</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Previews</th>
                <th className="p-3 font-medium"></th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3">{p.title}</td>
                  <td className="p-3">{p.type}</td>
                  <td className="p-3">{p.classLevel}</td>
                  <td className="p-3">{SUBJECT_LABELS[p.subject]}</td>
                  <td className="p-3">₹{(p.pricePaise / 100).toFixed(0)}</td>
                  <td className="p-3">{p.status}</td>
                  <td className="p-3">{p.previewUrls.length}</td>
                  <td className="p-3">
                    <Link
                      href={`/admin/products/${p.id}`}
                      className="font-medium"
                      style={{ color: 'var(--brand-primary)' }}
                    >
                      Edit
                    </Link>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id, p.title)}
                      disabled={pendingDeleteId === p.id}
                      className="font-medium text-red-600 disabled:opacity-60"
                    >
                      {pendingDeleteId === p.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
