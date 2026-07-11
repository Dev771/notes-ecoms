import Link from 'next/link';
import type { PublicProduct, Subject } from '@/lib/catalog';

const SUBJECT_COLORS: Record<Subject, string> = {
  SCIENCE: '#16a34a',
  MATHS: '#2563eb',
  SST: '#d97706',
  ENGLISH: '#9333ea',
};

const SUBJECT_LABELS: Record<Subject, string> = {
  SCIENCE: 'Science',
  MATHS: 'Maths',
  SST: 'SST',
  ENGLISH: 'English',
};

export function ProductCard({ product }: { product: PublicProduct }) {
  const {
    slug,
    title,
    classLevel,
    subject,
    chapterNo,
    pricePaise,
    coverUrl,
    type,
  } = product;
  const rupees = (pricePaise / 100).toFixed(0);

  return (
    <Link
      href={`/notes/${slug}`}
      className="group block overflow-hidden rounded-lg border transition hover:shadow-md"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
        {coverUrl ? (
          // Cover images are served from tenant/storage-provider hosts that
          // vary per deployment, so next/image's remotePatterns config isn't
          // set up for this yet — a plain <img> avoids that coupling.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={title}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-sm font-medium text-white"
            style={{ backgroundColor: SUBJECT_COLORS[subject] }}
          >
            {SUBJECT_LABELS[subject]}
          </div>
        )}
        {type === 'BUNDLE' ? (
          <span
            className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: 'var(--brand-accent)' }}
          >
            BUNDLE
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <h3 className="line-clamp-2 text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-gray-600">
          Class {classLevel} • {SUBJECT_LABELS[subject]}
          {chapterNo ? ` • Ch ${chapterNo}` : ''}
        </p>
        <p
          className="mt-2 text-sm font-bold"
          style={{ color: 'var(--brand-primary)' }}
        >
          ₹{rupees}
        </p>
      </div>
    </Link>
  );
}
