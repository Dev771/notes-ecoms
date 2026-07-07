import { getTenantConfig } from '@/lib/tenant-config';

export default async function HomePage() {
  const tenant = await getTenantConfig();
  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-3xl font-bold">
        Handwritten notes that make Class 9 &amp; 10 easy
      </h1>
      <p className="mt-2 text-gray-600">
        {tenant.name} — full storefront lands in Phase 2.
      </p>
    </main>
  );
}
