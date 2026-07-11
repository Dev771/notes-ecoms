import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { CatalogSearchParams, Subject } from '@/lib/catalog';

const CLASS_OPTIONS: { label: string; value?: string }[] = [
  { label: 'All', value: undefined },
  { label: 'Class 9', value: '9' },
  { label: 'Class 10', value: '10' },
];

const SUBJECT_OPTIONS: { label: string; value?: Subject }[] = [
  { label: 'All', value: undefined },
  { label: 'Science', value: 'SCIENCE' },
  { label: 'Maths', value: 'MATHS' },
  { label: 'SST', value: 'SST' },
  { label: 'English', value: 'ENGLISH' },
];

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Newest', value: 'newest' },
  { label: '₹ low → high', value: 'price_asc' },
  { label: '₹ high → low', value: 'price_desc' },
];

/**
 * Builds an `/notes` href that keeps the other active filters but applies
 * `overrides` on top, and always drops `q` — filters and search are
 * mutually exclusive in `NotesPage` (a `q` present short-circuits straight
 * to `searchProducts`, ignoring classLevel/subject/sort entirely), so a
 * filter/sort link that kept a stale `q` around would silently do nothing
 * while looking selected. Clicking a filter or sort link always means
 * "leave search mode, browse the catalog instead."
 */
function hrefFor(
  current: CatalogSearchParams,
  overrides: Partial<CatalogSearchParams>,
): string {
  const merged: CatalogSearchParams = {
    classLevel: current.classLevel,
    subject: current.subject,
    sort: current.sort,
    ...overrides,
  };
  const qs = new URLSearchParams();
  if (merged.classLevel) qs.set('classLevel', merged.classLevel);
  if (merged.subject) qs.set('subject', merged.subject);
  if (merged.sort) qs.set('sort', merged.sort);
  const s = qs.toString();
  return s ? `/notes?${s}` : '/notes';
}

function capsuleClassName(active: boolean): string {
  return active
    ? 'rounded-full px-3 py-1 text-sm font-medium text-white'
    : 'rounded-full border px-3 py-1 text-sm font-medium';
}

function capsuleStyle(active: boolean): CSSProperties {
  return active
    ? { backgroundColor: 'var(--brand-primary)' }
    : { borderColor: 'var(--brand-primary)', color: 'var(--brand-primary)' };
}

export function CatalogFilters({ current }: { current: CatalogSearchParams }) {
  const activeSort = current.sort ?? 'newest';

  return (
    <div className="mt-4 flex flex-col gap-4">
      <form
        action="/notes"
        method="get"
        role="search"
        className="flex max-w-md gap-2"
      >
        <input
          type="search"
          name="q"
          defaultValue={current.q ?? ''}
          placeholder="Search a chapter, e.g. “carbon” or “real numbers”"
          aria-label="Search notes"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--brand-primary)' }}
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {CLASS_OPTIONS.map((opt) => {
          const active = current.classLevel === opt.value;
          return (
            <Link
              key={opt.label}
              href={hrefFor(current, { classLevel: opt.value })}
              className={capsuleClassName(active)}
              style={capsuleStyle(active)}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {SUBJECT_OPTIONS.map((opt) => {
          const active = current.subject === opt.value;
          return (
            <Link
              key={opt.label}
              href={hrefFor(current, { subject: opt.value })}
              className={capsuleClassName(active)}
              style={capsuleStyle(active)}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <span>Sort:</span>
        {SORT_OPTIONS.map((opt) => {
          const active = activeSort === opt.value;
          return (
            <Link
              key={opt.value}
              href={hrefFor(current, { sort: opt.value })}
              className={capsuleClassName(active)}
              style={capsuleStyle(active)}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
