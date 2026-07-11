/**
 * Pure parsing/conversion helpers for the admin product form
 * (client/components/admin/product-form.tsx). Extracted from the form so
 * they can be unit-tested without rendering React (this project's Vitest
 * setup is environment:'node', no jsdom).
 */

/**
 * Splits on commas and newlines, trims each entry, drops empties, and
 * dedupes case-insensitively (first occurrence's casing wins). The dedupe
 * exists so paste artifacts ("carbon, Carbon") can't trip the server's
 * @ArrayUnique validation on aliases.
 */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export interface ParsedPreviewPages {
  /** Valid page numbers (positive integers), numerically deduped. */
  pages: number[];
  /**
   * Tokens that were dropped because they aren't positive whole numbers
   * ("1.5", "abc", "0", "-3"). Callers must surface these to the admin —
   * silently discarding input is how a typo becomes a missing preview page.
   */
  invalid: string[];
}

export function parsePreviewPages(text: string): ParsedPreviewPages {
  const pages: number[] = [];
  const invalid: string[] = [];
  for (const token of parseList(text)) {
    const n = Number(token);
    if (Number.isInteger(n) && n >= 1) {
      // Numeric dedupe on top of parseList's string dedupe ("1" vs "01").
      if (!pages.includes(n)) pages.push(n);
    } else {
      invalid.push(token);
    }
  }
  return { pages, invalid };
}

/**
 * Admin enters price in rupees; the API stores integer paise (₹1 = 100
 * paise) — this is the single conversion point. Math.round absorbs binary
 * float artifacts (19.99 * 100 === 1998.9999999999998 → 1999). Blank or
 * non-numeric input maps to 0: the form's required number input keeps
 * garbage from reaching here in practice, and 0 is within the DTO's
 * pricePaise minimum anyway.
 */
export function rupeesToPaise(rupeesText: string): number {
  if (rupeesText.trim() === '') return 0;
  const n = Number(rupeesText);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
