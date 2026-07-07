import type { Metadata } from 'next';
import './globals.css';
import { getTenantConfig } from '@/lib/tenant-config';
import { brandingToCssVars } from '@/lib/branding';
import { SiteHeader } from '@/components/site-header';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantConfig();
  return {
    title: { default: tenant.name, template: `%s | ${tenant.name}` },
    description: `Handwritten notes by ${tenant.name}`,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await getTenantConfig();
  return (
    <html lang="en" style={brandingToCssVars(tenant.branding)}>
      <body className="min-h-screen antialiased">
        <SiteHeader tenantName={tenant.name} />
        {children}
      </body>
    </html>
  );
}
