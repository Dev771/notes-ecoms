'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  createProduct,
  generatePreviews,
  listAdminProducts,
  replaceAliases,
  replaceBundleItems,
  updateProduct,
  verifyDrive,
  type AdminProduct,
  type AdminProductListItem,
  type ProductStatus,
  type VerifyDriveResult,
} from '@/lib/admin-api';
import {
  parseList,
  parsePreviewPages,
  rupeesToPaise,
} from '@/lib/admin-form-utils';
import type { ProductType, Subject } from '@/lib/catalog';

// Mirrors client/components/product-card.tsx's SUBJECT_LABELS (kept private
// there).
const SUBJECT_LABELS: Record<Subject, string> = {
  SCIENCE: 'Science',
  MATHS: 'Maths',
  SST: 'SST',
  ENGLISH: 'English',
};
const SUBJECTS: Subject[] = ['SCIENCE', 'MATHS', 'SST', 'ENGLISH'];
const STATUSES: ProductStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

const inputClass = 'w-full rounded-md border px-3 py-2 text-sm';
const labelClass = 'text-sm font-medium';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

interface ProductFormProps {
  /** Present in edit mode (`/admin/products/[id]`); absent when creating. */
  productId?: string;
}

export function ProductForm({ productId }: ProductFormProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allProducts, setAllProducts] = useState<AdminProductListItem[]>([]);
  const [existing, setExisting] = useState<AdminProductListItem | null>(null);

  // Controlled form fields.
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProductType>('NOTE');
  const [classLevel, setClassLevel] = useState(10);
  const [subject, setSubject] = useState<Subject>('SCIENCE');
  const [chapterNoText, setChapterNoText] = useState('');
  const [priceRupeesText, setPriceRupeesText] = useState('');
  const [driveFileId, setDriveFileId] = useState('');
  const [previewPagesText, setPreviewPagesText] = useState('');
  const [status, setStatus] = useState<ProductStatus>('DRAFT');
  const [aliasesText, setAliasesText] = useState('');
  const [bundleNoteIds, setBundleNoteIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // CREATE-mode only: once step 1 (product create) succeeds, the new id is
  // pinned here so a retry after a later step fails (aliases/bundle items)
  // UPDATES this product instead of re-POSTing a duplicate (which would
  // 409 on the slug).
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Verify Drive (edit only).
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyDriveResult | null>(
    null,
  );
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Generate Previews (edit only).
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    listAdminProducts()
      .then(({ items }) => {
        if (cancelled) return;
        setAllProducts(items);
        if (productId) {
          const found = items.find((p) => p.id === productId);
          if (!found) {
            setLoadError('Product not found');
          } else {
            setExisting(found);
            setSlug(found.slug);
            setTitle(found.title);
            setDescription(found.description);
            setType(found.type);
            setClassLevel(found.classLevel);
            setSubject(found.subject);
            setChapterNoText(
              found.chapterNo != null ? String(found.chapterNo) : '',
            );
            // Stored as integer paise; the form always works in rupees.
            setPriceRupeesText((found.pricePaise / 100).toString());
            setDriveFileId(found.driveFileId ?? '');
            setPreviewPagesText(found.previewPages.join(', '));
            setStatus(found.status);
            setAliasesText((found.aliases ?? []).join(', '));
            setPreviewUrls(found.previewUrls);
          }
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to load');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const noteOptions = allProducts.filter(
    (p) => p.type === 'NOTE' && p.id !== productId,
  );

  // Derived on every keystroke: tokens that would be silently dropped on
  // submit are instead surfaced next to the field (amber warning below).
  const invalidPreviewTokens = parsePreviewPages(previewPagesText).invalid;

  function toggleBundleNote(noteId: string) {
    setBundleNoteIds((prev) =>
      prev.includes(noteId)
        ? prev.filter((id) => id !== noteId)
        : [...prev, noteId],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    // productId = edit page; createdId = create page after a partial
    // failure (step 1 succeeded on an earlier submit) — either way, PATCH.
    const editId = productId ?? createdId;

    const base = {
      type,
      slug: slug.trim(),
      title: title.trim(),
      description: description.trim(),
      classLevel,
      subject,
      // ₹ → integer paise; see rupeesToPaise (lib/admin-form-utils.ts).
      pricePaise: rupeesToPaise(priceRupeesText),
      previewPages: parsePreviewPages(previewPagesText).pages,
      status,
    };

    // The save is 3 sequential calls (product, aliases, bundle items) — the
    // API has no combined transactional endpoint, so each step reports its
    // own failure honestly instead of one blended message.
    let savedProduct: AdminProduct;
    try {
      savedProduct = editId
        ? await updateProduct(editId, {
            ...base,
            // PATCH: blank input sends an explicit null to CLEAR any
            // previously-set value (omitting the key would leave it
            // unchanged — see UpdateProductBody in lib/admin-api.ts).
            chapterNo:
              chapterNoText.trim() === '' ? null : Number(chapterNoText),
            driveFileId: driveFileId.trim() === '' ? null : driveFileId.trim(),
          })
        : await createProduct({
            ...base,
            // CREATE: nothing to clear — blank simply omits the field.
            chapterNo:
              chapterNoText.trim() === '' ? undefined : Number(chapterNoText),
            driveFileId:
              driveFileId.trim() === '' ? undefined : driveFileId.trim(),
          });
      if (!editId) setCreatedId(savedProduct.id);
    } catch (err) {
      setSaveError(`Failed to save product: ${messageOf(err)}`);
      setSaving(false);
      return;
    }

    try {
      await replaceAliases(savedProduct.id, parseList(aliasesText));
    } catch (err) {
      setSaveError(
        `Product saved, but aliases failed: ${messageOf(err)} — fix and resubmit`,
      );
      setSaving(false);
      return;
    }

    if (type === 'BUNDLE') {
      try {
        await replaceBundleItems(savedProduct.id, bundleNoteIds);
      } catch (err) {
        setSaveError(
          `Product saved, but bundle items failed: ${messageOf(err)} — fix and resubmit`,
        );
        setSaving(false);
        return;
      }
    }

    if (productId) {
      setSaved(true);
    } else {
      router.push(`/admin/products/${savedProduct.id}`);
    }
    setSaving(false);
  }

  async function handleVerifyDrive() {
    if (!productId) return;
    setVerifying(true);
    setVerifyError(null);
    setVerifyResult(null);
    try {
      setVerifyResult(await verifyDrive(productId));
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verify failed');
    } finally {
      setVerifying(false);
    }
  }

  async function handleGeneratePreviews() {
    if (!productId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await generatePreviews(productId);
      setJobId(result.jobId);
    } catch (err) {
      setGenerateError(
        err instanceof Error
          ? err.message
          : 'Failed to queue preview generation',
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleRefresh() {
    if (!productId) return;
    setRefreshing(true);
    try {
      const { items } = await listAdminProducts();
      const fresh = items.find((p) => p.id === productId);
      if (fresh) setPreviewUrls(fresh.previewUrls);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-600">Loading…</p>;
  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;

  return (
    <div className="max-w-2xl">
      {/* onChange bubbles from every input/select/textarea/checkbox below —
          any field edit invalidates a stale "Saved." confirmation. */}
      <form
        onSubmit={handleSubmit}
        onChange={() => setSaved(false)}
        className="flex flex-col gap-4"
      >
        <div>
          <label className={labelClass} htmlFor="slug">
            Slug
          </label>
          <input
            id="slug"
            className={inputClass}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            lowercase letters, numbers, hyphens only
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            className={inputClass}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="type">
              Type
            </label>
            <select
              id="type"
              className={inputClass}
              value={type}
              onChange={(e) => setType(e.target.value as ProductType)}
            >
              <option value="NOTE">NOTE</option>
              <option value="BUNDLE">BUNDLE</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="status">
              Status
            </label>
            <select
              id="status"
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ProductStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="classLevel">
              Class
            </label>
            <select
              id="classLevel"
              className={inputClass}
              value={classLevel}
              onChange={(e) => setClassLevel(Number(e.target.value))}
            >
              <option value={9}>9</option>
              <option value={10}>10</option>
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="subject">
              Subject
            </label>
            <select
              id="subject"
              className={inputClass}
              value={subject}
              onChange={(e) => setSubject(e.target.value as Subject)}
            >
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {SUBJECT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="chapterNo">
              Chapter no.
            </label>
            <input
              id="chapterNo"
              className={inputClass}
              type="number"
              min={1}
              max={30}
              value={chapterNoText}
              onChange={(e) => setChapterNoText(e.target.value)}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="price">
              Price (₹)
            </label>
            <input
              id="price"
              className={inputClass}
              type="number"
              min={0}
              step="0.01"
              value={priceRupeesText}
              onChange={(e) => setPriceRupeesText(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="driveFileId">
            Drive file ID
          </label>
          <input
            id="driveFileId"
            className={inputClass}
            value={driveFileId}
            onChange={(e) => setDriveFileId(e.target.value)}
            placeholder="e.g. 197SzeM2l8WiIMtVwx-JViV9jrnR04wJm"
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="previewPages">
            Preview pages
          </label>
          <input
            id="previewPages"
            className={inputClass}
            value={previewPagesText}
            onChange={(e) => setPreviewPagesText(e.target.value)}
            placeholder="1, 2, 3"
          />
          <p className="mt-1 text-xs text-gray-500">
            comma-separated PDF page numbers to render as previews
          </p>
          {invalidPreviewTokens.length > 0 ? (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Ignoring invalid page number
              {invalidPreviewTokens.length > 1 ? 's' : ''}:{' '}
              {invalidPreviewTokens.join(', ')} — whole numbers of 1 or more
              only
            </p>
          ) : null}
        </div>

        <div>
          <label className={labelClass} htmlFor="aliases">
            Aliases
          </label>
          {existing && existing.aliasCount > 0 ? (
            <p className="mt-1 text-xs text-gray-500">
              Currently has {existing.aliasCount} alias(es) — the API only
              exposes a count, not the values, so this box starts empty. Saving
              replaces the full list with whatever you enter below.
            </p>
          ) : null}
          <textarea
            id="aliases"
            className={inputClass}
            rows={2}
            value={aliasesText}
            onChange={(e) => setAliasesText(e.target.value)}
            placeholder="comma or newline separated, e.g. carbon, ch 4 science"
          />
        </div>

        {type === 'BUNDLE' ? (
          <div>
            <span className={labelClass}>Notes in this bundle</span>
            {existing && existing.bundleItemCount > 0 ? (
              <p className="mt-1 text-xs text-gray-500">
                Currently linked to {existing.bundleItemCount} note(s) — not
                pre-selected below for the same reason as aliases above. Saving
                replaces the full set with your selection.
              </p>
            ) : null}
            <div className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {noteOptions.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No NOTE products available yet.
                </p>
              ) : (
                noteOptions.map((note) => (
                  <label
                    key={note.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={bundleNoteIds.includes(note.id)}
                      onChange={() => toggleBundleNote(note.id)}
                    />
                    {note.title}
                  </label>
                ))
              )}
            </div>
          </div>
        ) : null}

        {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
        {saved ? <p className="text-sm text-green-700">Saved.</p> : null}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: 'var(--brand-primary)' }}
        >
          {saving ? 'Saving…' : productId ? 'Save changes' : 'Create product'}
        </button>
      </form>

      {productId ? (
        <div className="mt-8 flex flex-col gap-6 border-t pt-6">
          <section>
            <h2 className="text-sm font-semibold">Google Drive</h2>
            <button
              type="button"
              onClick={handleVerifyDrive}
              disabled={verifying}
              className="mt-2 rounded-md border px-4 py-2 text-sm disabled:opacity-60"
            >
              {verifying ? 'Verifying…' : 'Verify Drive'}
            </button>
            {verifyResult ? (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span>{verifyResult.name}</span>
                <span
                  className={
                    verifyResult.copyProtection === 'set'
                      ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
                      : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
                  }
                >
                  {verifyResult.copyProtection === 'set'
                    ? 'download-blocking ON'
                    : 'owner must toggle “Viewers can’t download” in Drive'}
                </span>
              </div>
            ) : null}
            {verifyError ? (
              <p className="mt-2 text-sm text-red-600">{verifyError}</p>
            ) : null}
          </section>

          <section>
            <h2 className="text-sm font-semibold">Previews</h2>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleGeneratePreviews}
                disabled={generating}
                className="rounded-md border px-4 py-2 text-sm disabled:opacity-60"
              >
                {generating ? 'Queuing…' : 'Generate Previews'}
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="rounded-md border px-4 py-2 text-sm disabled:opacity-60"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {jobId ? (
              <p className="mt-2 text-sm text-gray-600">queued (job {jobId})</p>
            ) : null}
            {generateError ? (
              <p className="mt-2 text-sm text-red-600">{generateError}</p>
            ) : null}
            {previewUrls.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {previewUrls.map((url, i) => (
                  // Preview images are served from a storage-provider host
                  // that varies per deployment (same reasoning as
                  // ProductCard/PreviewGallery) — plain <img>, not next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt={`Preview page ${i + 1}`}
                    className="h-28 w-auto rounded border object-contain"
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">No previews yet.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
