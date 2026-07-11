import { redirect } from 'next/navigation';

// Products is the only admin section for now (see the layout's subnav) — a
// bare visit to /admin sends the admin straight there instead of 404ing.
export default function AdminIndexPage() {
  redirect('/admin/products');
}
