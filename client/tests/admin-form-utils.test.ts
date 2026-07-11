import { describe, it, expect } from 'vitest';
import {
  parseList,
  parsePreviewPages,
  rupeesToPaise,
} from '@/lib/admin-form-utils';

describe('parseList', () => {
  it('splits on commas and newlines and trims each entry', () => {
    expect(parseList('carbon, ch 4 science\n first flight ')).toEqual([
      'carbon',
      'ch 4 science',
      'first flight',
    ]);
  });

  it('drops empty segments (trailing commas, blank lines)', () => {
    expect(parseList('a,,b,\n\n c ,')).toEqual(['a', 'b', 'c']);
  });

  it('dedupes case-insensitively, keeping the first occurrence casing', () => {
    expect(parseList('Carbon, carbon, CARBON, ch 4, Ch 4')).toEqual([
      'Carbon',
      'ch 4',
    ]);
  });

  it('returns [] for blank input', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList('  \n , ')).toEqual([]);
  });
});

describe('parsePreviewPages', () => {
  it('parses comma-separated positive integers', () => {
    expect(parsePreviewPages('1, 2, 3')).toEqual({
      pages: [1, 2, 3],
      invalid: [],
    });
  });

  it('flags non-integer tokens as invalid instead of silently dropping them', () => {
    expect(parsePreviewPages('1, 1.5, abc, 2')).toEqual({
      pages: [1, 2],
      invalid: ['1.5', 'abc'],
    });
  });

  it('flags zero and negatives as invalid (pages are 1-based)', () => {
    expect(parsePreviewPages('0, -3, 4')).toEqual({
      pages: [4],
      invalid: ['0', '-3'],
    });
  });

  it('dedupes numerically, including differing string forms ("1" vs "01")', () => {
    expect(parsePreviewPages('1, 1, 01, 2')).toEqual({
      pages: [1, 2],
      invalid: [],
    });
  });

  it('returns empty results for blank input', () => {
    expect(parsePreviewPages('')).toEqual({ pages: [], invalid: [] });
  });
});

describe('rupeesToPaise', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise('49')).toBe(4900);
  });

  it('rounds away binary float artifacts (19.99 * 100 = 1998.999…)', () => {
    expect(rupeesToPaise('19.99')).toBe(1999);
  });

  it('handles the smallest unit', () => {
    expect(rupeesToPaise('0.01')).toBe(1);
  });

  it('maps blank/whitespace input to 0', () => {
    expect(rupeesToPaise('')).toBe(0);
    expect(rupeesToPaise('   ')).toBe(0);
  });

  it('maps non-numeric input to 0 rather than NaN', () => {
    expect(rupeesToPaise('abc')).toBe(0);
  });
});
