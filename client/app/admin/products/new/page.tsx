import Link from 'next/link';
import { ProductForm } from '@/components/admin/product-form';

// Server Component wrapper (no 'use client' needed) — it just renders the
// Client Component form directly, same pattern as the rest of this app
// (e.g. app/notes/[slug]/page.tsx rendering <PreviewGallery>).
export default function NewProductPage() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">New product</h1>
        <Link href="/admin/products" className="text-sm text-gray-600">
          Back to products
        </Link>
      </div>
      <ProductForm />
    </div>
  );
}
