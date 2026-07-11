import type { Subject } from '@prisma/client';

/** Pure result of parsing free-text academic search input. */
export interface ParsedAcademicQuery {
  classLevel?: number;
  subject?: Subject;
  chapterNo?: number;
  residual: string;
}

// Subject synonyms. The two-word "social science" form is checked before the
// single-word "social" (both resolve to SST) so "social science class 10"
// consumes both words as one subject hit — otherwise "social" alone would
// claim SST and the leftover "science" token would either dangle in the
// residual or be misread as the SCIENCE subject.
const SUBJECT_SYNONYMS: Record<string, Subject> = {
  sci: 'SCIENCE',
  science: 'SCIENCE',
  math: 'MATHS',
  maths: 'MATHS',
  mathematics: 'MATHS',
  sst: 'SST',
  social: 'SST',
  eng: 'ENGLISH',
  english: 'ENGLISH',
};

const CLASS_WORDS = new Set(['class', 'cls']);
const CHAPTER_WORDS = new Set(['ch', 'chapter']);

/** Second token of a two-word class pattern: "class 10" | "cls 10th" ... */
const CLASS_NUMBER_TOKEN = /^(?:9|10)(?:th)?$/;
/** Standalone "10th" | "9th" (no preceding "class"/"cls"). */
const STANDALONE_CLASS_TOKEN = /^(?:9|10)th$/;
/** Standalone "ch4" — chapter digits fused onto "ch" with no space. */
const STANDALONE_CHAPTER_TOKEN = /^ch(\d+)$/;

/**
 * Parses academic search shorthand ("ch 4 sci", "10th maths", "social
 * science class 10", ...) into structured filter hints, leaving whatever
 * text isn't consumed as `residual` (order-preserving) for trigram matching
 * against product titles/aliases. Pure and side-effect free.
 *
 * See query-parser.spec.ts for the exact input/output table this satisfies.
 */
export function parseAcademicQuery(q: string): ParsedAcademicQuery {
  const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);

  let classLevel: number | undefined;
  let subject: Subject | undefined;
  let chapterNo: number | undefined;
  const residual: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const next: string | undefined = tokens[i + 1];

    // Two-word subject: "social science" — tried before the single-word
    // "social" check below.
    if (token === 'social' && next === 'science') {
      if (subject === undefined) subject = 'SST';
      i += 2;
      continue;
    }

    // Two-word class: "class 10" | "cls 10" | "class 10th" | "cls 9th" ...
    if (
      next !== undefined &&
      CLASS_WORDS.has(token) &&
      CLASS_NUMBER_TOKEN.test(next)
    ) {
      if (classLevel === undefined) classLevel = parseInt(next, 10);
      i += 2;
      continue;
    }

    // Two-word chapter: "ch 4" | "chapter 4"
    if (next !== undefined && CHAPTER_WORDS.has(token) && /^\d+$/.test(next)) {
      if (chapterNo === undefined) chapterNo = parseInt(next, 10);
      i += 2;
      continue;
    }

    // Standalone class: "10th" | "9th"
    if (STANDALONE_CLASS_TOKEN.test(token)) {
      if (classLevel === undefined) classLevel = parseInt(token, 10);
      i += 1;
      continue;
    }

    // Standalone chapter: "ch4"
    const chapterMatch = STANDALONE_CHAPTER_TOKEN.exec(token);
    if (chapterMatch) {
      if (chapterNo === undefined) chapterNo = parseInt(chapterMatch[1], 10);
      i += 1;
      continue;
    }

    // Single-word subject synonym.
    const synonym = SUBJECT_SYNONYMS[token];
    if (synonym !== undefined) {
      if (subject === undefined) subject = synonym;
      i += 1;
      continue;
    }

    residual.push(token);
    i += 1;
  }

  return { classLevel, subject, chapterNo, residual: residual.join(' ') };
}
