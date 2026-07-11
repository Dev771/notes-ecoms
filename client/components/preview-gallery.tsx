'use client';

import { useState } from 'react';

interface PreviewGalleryProps {
  urls: string[];
  title: string;
}

/**
 * Main image + clickable thumbnail strip for a product's sample pages.
 * Deliberately subject-agnostic (no `subject`/color prop) — the empty state
 * below is the same regardless of what's being previewed. Preview images
 * are served from tenant/storage-provider hosts that vary per deployment,
 * so plain `<img>` is used instead of `next/image` (same reasoning as
 * `ProductCard`'s cover image).
 */
export function PreviewGallery({ urls, title }: PreviewGalleryProps) {
  const [selected, setSelected] = useState(0);

  if (urls.length === 0) {
    return (
      <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          className="h-10 w-10 text-gray-300"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm font-medium text-gray-500">
          No preview available yet
        </p>
      </div>
    );
  }

  const activeIndex = selected < urls.length ? selected : 0;
  const activeUrl = urls[activeIndex];

  return (
    <div>
      <div className="aspect-[3/4] w-full overflow-hidden rounded-lg border bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activeUrl}
          alt={`${title} preview page ${activeIndex + 1}`}
          className="h-full w-full object-contain"
        />
      </div>
      {urls.length > 1 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {urls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setSelected(i)}
              aria-label={`Show preview page ${i + 1}`}
              aria-current={i === activeIndex}
              className="aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-md bg-gray-100"
              style={{
                boxShadow:
                  i === activeIndex
                    ? '0 0 0 2px var(--brand-primary)'
                    : undefined,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
