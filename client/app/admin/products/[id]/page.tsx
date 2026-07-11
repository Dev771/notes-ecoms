import Link from 'next/link';
import { ProductForm } from '@/components/admin/product-form';

type EditProductPageProps = {
  params: Promise<{ id: string }>;
};

// Async Server Component awaiting `params` — same convention as
// app/notes/[slug]/page.tsx. Renders the Client Component form directly.
export default async function EditProductPage({
  params,
}: EditProductPageProps) {
  const { id } = await params;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit product</h1>
        <Link href="/admin/products" className="text-sm text-gray-600">
          Back to products
        </Link>
      </div>
      <ProductForm productId={id} />
    </div>
  );
}
