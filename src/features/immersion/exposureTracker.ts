import { db } from '../../db/database';
import type { ExposureMark } from '../../types';

/**
 * Decides which sightings of a word count as a new encounter.
 *
 * Only text read for the first time counts: each book keeps the furthest
 * position whose words were counted, and anything at or before it (re-reading,
 * the screen shown again when resuming) is ignored. Within one chapter a word
 * counts at most MAX_PER_CHAPTER times, so learning comes from encounters
 * spread over many chapters rather than one page. Both survive reloads.
 */

export const MAX_PER_CHAPTER = 3;
const SAVE_DELAY_MS = 1000;

let bookId: string | null = null;
let mark: ExposureMark | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const EMPTY: ExposureMark = { chapter: -1, sentence: -1, counts: {} };

function isAfter(chapter: number, sentence: number, reference: ExposureMark): boolean {
  return chapter > reference.chapter || (chapter === reference.chapter && sentence > reference.sentence);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  const id = bookId;
  const snapshot = mark;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (id && snapshot) void db.books.update(id, { exposureMark: snapshot }).catch(() => undefined);
  }, SAVE_DELAY_MS);
}

/** Flush a pending save (e.g. when leaving the reader). */
export function flushExposureMark(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (bookId && mark) void db.books.update(bookId, { exposureMark: mark }).catch(() => undefined);
}

/**
 * Start counting for a book. Everything before the position the reader resumes
 * at was read already — possibly on another device — so it never counts.
 */
export async function startExposureTracking(id: string): Promise<void> {
  flushExposureMark();
  bookId = id;
  mark = null;
  const book = await db.books.get(id);
  if (bookId !== id || !book) return;
  let current: ExposureMark = book.exposureMark ?? EMPTY;
  const resumeChapter = book.lastReadChapterIndex ?? 0;
  const resumeSentence = book.lastReadSentenceId ? (await db.sentences.get(book.lastReadSentenceId))?.index ?? 0 : 0;
  if (bookId !== id) return;
  if (isAfter(resumeChapter, resumeSentence, current)) {
    current = {
      chapter: resumeChapter,
      sentence: resumeSentence,
      counts: resumeChapter === current.chapter ? current.counts : {},
    };
  }
  mark = current;
}

export function stopExposureTracking(): void {
  flushExposureMark();
  bookId = null;
  mark = null;
}

/**
 * A sentence at (chapter, sentence) of the tracked book was seen with these
 * words woven in. Returns the words that count as a new encounter.
 */
export function countEncounters(forBookId: string, chapter: number, sentence: number, words: string[]): string[] {
  if (forBookId !== bookId || !mark) return [];
  if (!isAfter(chapter, sentence, mark)) return [];
  const counts = chapter === mark.chapter ? { ...mark.counts } : {};
  const counted: string[] = [];
  for (const word of new Set(words)) {
    const seen = counts[word] ?? 0;
    if (seen >= MAX_PER_CHAPTER) continue;
    counts[word] = seen + 1;
    counted.push(word);
  }
  mark = { chapter, sentence, counts };
  scheduleSave();
  return counted;
}

/** Test helper. */
export function exposureMarkForTests(): ExposureMark | null {
  return mark;
}
