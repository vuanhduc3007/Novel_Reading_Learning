import { create } from 'zustand';
import { db } from '../db/database';
import { loadHanViet } from '../features/immersion/hanVietData';
import { buildBookWordStats } from '../features/immersion/wordStats';
import { markManyDirty, markSettingsChanged } from '../features/sync/localChanges';
import { countUpcomingWords } from '../features/immersion/upcomingWords';
import { currentReadPosition, type ReadingPosition } from '../features/immersion/exposureTracker';
import type { HanVietData, HanVietIndex, WordMatch } from '../features/immersion/wordMatcher';
import type { BookWordStats, WordLearningStatus, WordProgress } from '../types';

/**
 * Vietnamese-first reading ("diglot weave").
 *
 * The learner reads the Vietnamese translation. A small set of Chinese words
 * appear in Chinese in place of their Vietnamese counterpart:
 *  - new words are the ones occurring most in the next chapters to be read,
 *    so they come back again and again right after being introduced, and
 *    they appear only from the point where they were introduced (text read
 *    in earlier sessions never shows new words);
 *  - first with the Vietnamese meaning shown above them,
 *  - after HINT_EXPOSURES encounters without it: the reader must recall the
 *    meaning (tap to peek; peeking brings the hint back for a while),
 *  - known after RECALL_STREAK encounters in a row recalled without peeking
 *    (or when the learner says so); known words stay in Chinese everywhere
 *    and a new word takes the free slot.
 * Over time the text turns more and more Chinese at the learner's own pace.
 */

/** Encounters with the hint before it is removed (at most 3 count per chapter). */
export const HINT_EXPOSURES = 8;
/** Encounters in a row with the meaning hidden and not peeked at → known. */
export const RECALL_STREAK = 15;
/** After peeking at a hidden meaning, the meaning shows for this many encounters. */
const HINT_AGAIN_AFTER_PEEK = 3;
/** Words that occur fewer times in the book are not worth a learning slot. */
const MIN_OCCURRENCES = 3;
export const LEARNING_SIZES = [5, 10, 20, 40] as const;
const DEFAULT_LEARNING_SIZE = 10;
const STATS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readLearningSize(): number {
  try {
    const value = Number(localStorage.getItem('immersion-learning-size'));
    return (LEARNING_SIZES as readonly number[]).includes(value) ? value : DEFAULT_LEARNING_SIZE;
  } catch {
    return DEFAULT_LEARNING_SIZE;
  }
}

export interface OpenWordCard {
  word: string;
  /** Vietnamese span the word replaced in this sentence. */
  vi: string;
  kind: WordMatch['kind'];
  anchor: { x: number; y: number; width: number; height: number };
}

interface ImmersionState {
  ready: boolean;
  bookId: string | null;
  data: HanVietData | null;
  index: HanVietIndex | null;
  stats: BookWordStats | null;
  statsBuilding: boolean;
  progress: Map<string, WordProgress>;
  learningSize: number;
  /** Words currently being learned (shown in Chinese with/without hint). */
  learning: Set<string>;
  /** Known words: always shown in Chinese. */
  known: Set<string>;
  card: OpenWordCard | null;
  /** Word frequencies in the chapters about to be read, and where they start. */
  upcoming: Map<string, number> | null;
  upcomingFrom: number;
  /** Where the current reading session started: text up to here was read before. */
  sessionStart: ReadingPosition | null;
  /** Learning words introduced during this session, visible only after this point. */
  visibleFrom: Map<string, ReadingPosition>;

  init: (bookId: string) => Promise<void>;
  /** The reader is now in this chapter: refresh the upcoming-word counts if needed. */
  setReadingChapter: (chapterIndex: number) => Promise<void>;
  setSessionStart: (position: ReadingPosition | null) => void;
  rebuildStats: () => Promise<void>;
  setLearningSize: (size: number) => void;
  setStatus: (word: string, status: WordLearningStatus) => void;
  recordExposures: (words: string[]) => void;
  peek: (word: string) => void;
  openCard: (card: OpenWordCard) => void;
  closeCard: () => void;
  showsHint: (word: string) => boolean;
  /** Re-read word progress from IndexedDB (after a sync). */
  reloadProgress: () => Promise<void>;
  reloadSettings: () => void;
}

let initSession = 0;
let pendingWrites = new Map<string, WordProgress>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const rows = [...pendingWrites.values()];
    pendingWrites = new Map();
    db.wordProgress.bulkPut(rows)
      .then(() => markManyDirty('word', rows.map(row => row.word)))
      .catch(error => console.error('Failed to save word progress', error));
  }, 2000);
}

function persist(entry: WordProgress) {
  pendingWrites.set(entry.word, entry);
  scheduleFlush();
}

/**
 * Known words, and the words being learned: those already started stay (so
 * nothing disappears mid-way); free slots go to the words that occur most in
 * the upcoming chapters, then to the book's most frequent words.
 */
export function computeSets(
  stats: BookWordStats | null,
  progress: Map<string, WordProgress>,
  size: number,
  upcoming: Map<string, number> | null = null,
) {
  const known = new Set<string>();
  for (const entry of progress.values()) if (entry.status === 'known') known.add(entry.word);
  const learning = new Set<string>();
  const available = (word: string) => {
    const status = progress.get(word)?.status;
    return status !== 'known' && status !== 'ignored';
  };
  const words = stats?.words ?? [];
  for (const [word] of words) {
    const entry = progress.get(word);
    if (entry?.status === 'learning' && entry.exposures > 0 && learning.size < size) learning.add(word);
  }
  if (upcoming) {
    const soon = [...upcoming].filter(([, count]) => count >= MIN_OCCURRENCES).sort((a, b) => b[1] - a[1]);
    for (const [word] of soon) {
      if (learning.size >= size) break;
      if (available(word)) learning.add(word);
    }
  }
  for (const [word, count] of words) {
    if (learning.size >= size) break;
    if (count < MIN_OCCURRENCES) break;
    if (available(word)) learning.add(word);
  }
  return { known, learning };
}

/**
 * Whether `word` is shown in Chinese at (chapter, sentence). Known words:
 * everywhere. Words being learned: only in text not read before this reading
 * session, and only from the position where the word was introduced.
 */
export function canWeave(
  word: string,
  chapter: number,
  sentence: number,
  state: Pick<ImmersionState, 'known' | 'learning' | 'visibleFrom' | 'sessionStart'>,
): boolean {
  if (state.known.has(word)) return true;
  if (!state.learning.has(word)) return false;
  const from = state.visibleFrom.get(word) ?? state.sessionStart;
  return !from || chapter > from.chapter || (chapter === from.chapter && sentence > from.sentence);
}

/**
 * computeSets, plus: a word that becomes a learning word now is shown only
 * from the current reading position on, never in text already read.
 */
function withSets(
  get: () => ImmersionState,
  stats: BookWordStats | null,
  progress: Map<string, WordProgress>,
  size: number,
  upcoming: Map<string, number> | null,
) {
  const sets = computeSets(stats, progress, size, upcoming);
  const { learning: before, visibleFrom, bookId, sessionStart } = get();
  const here = bookId ? currentReadPosition(bookId) : null;
  let nextVisible = visibleFrom;
  if (here && sessionStart) {
    for (const word of sets.learning) {
      if (before.has(word) || visibleFrom.has(word)) continue;
      if (nextVisible === visibleFrom) nextVisible = new Map(visibleFrom);
      nextVisible.set(word, here);
    }
  }
  return { ...sets, visibleFrom: nextVisible };
}

export const useImmersionStore = create<ImmersionState>((set, get) => ({
  ready: false,
  bookId: null,
  data: null,
  index: null,
  stats: null,
  statsBuilding: false,
  progress: new Map(),
  learningSize: readLearningSize(),
  learning: new Set(),
  known: new Set(),
  card: null,
  upcoming: null,
  upcomingFrom: -1,
  sessionStart: null,
  visibleFrom: new Map(),

  init: async (bookId) => {
    const session = ++initSession;
    if (get().bookId !== bookId) {
      // sessionStart/visibleFrom belong to the reader session (setSessionStart).
      set({ ready: false, bookId, stats: null, card: null, upcoming: null, upcomingFrom: -1 });
    }
    const [{ data, index }, rows, stats] = await Promise.all([
      loadHanViet(),
      db.wordProgress.toArray(),
      db.wordStats.get(bookId),
    ]);
    if (session !== initSession) return;
    const progress = new Map(rows.map(row => [row.word, row]));
    set({ data, index, progress, stats: stats ?? null, ready: true, ...withSets(get, stats ?? null, progress, get().learningSize, get().upcoming) });
    const stale = !stats || stats.words.length < 200 || Date.now() - stats.builtAt > STATS_MAX_AGE_MS;
    if (stale) await get().rebuildStats();
  },

  rebuildStats: async () => {
    const { bookId, statsBuilding } = get();
    if (!bookId || statsBuilding) return;
    const session = initSession;
    set({ statsBuilding: true });
    try {
      const stats = await buildBookWordStats(bookId);
      if (session !== initSession || get().bookId !== bookId) return;
      set({ stats, ...withSets(get, stats, get().progress, get().learningSize, get().upcoming) });
    } catch (error) {
      console.error('Failed to build word statistics', error);
    } finally {
      if (session === initSession) set({ statsBuilding: false });
    }
  },

  setLearningSize: (size) => {
    if (!(LEARNING_SIZES as readonly number[]).includes(size)) return;
    try { localStorage.setItem('immersion-learning-size', String(size)); } catch { /* optional */ }
    markSettingsChanged();
    const { stats, progress } = get();
    set({ learningSize: size, ...withSets(get, stats, progress, size, get().upcoming) });
  },

  setStatus: (word, status) => {
    const progress = new Map(get().progress);
    const previous = progress.get(word);
    const entry: WordProgress = {
      word,
      status,
      // Moving a known word back to learning shows the hint again.
      exposures: status === 'learning' ? 0 : previous?.exposures ?? 0,
      streak: 0,
      updatedAt: Date.now(),
    };
    progress.set(word, entry);
    persist(entry);
    set({ progress, ...withSets(get, get().stats, progress, get().learningSize, get().upcoming) });
  },

  recordExposures: (words) => {
    if (words.length === 0) return;
    const { learning } = get();
    let progress: Map<string, WordProgress> | null = null;
    let graduated = false;
    for (const word of words) {
      if (!learning.has(word)) continue;
      progress ??= new Map(get().progress);
      const previous = progress.get(word);
      const before = previous?.exposures ?? 0;
      const exposures = before + 1;
      // Seen with the meaning hidden (peeking resets this): one more recall in a row.
      const streak = before >= HINT_EXPOSURES ? (previous?.streak ?? 0) + 1 : 0;
      const status: WordLearningStatus = streak >= RECALL_STREAK ? 'known' : 'learning';
      if (status === 'known') graduated = true;
      const entry: WordProgress = { word, status, exposures, streak, updatedAt: Date.now() };
      progress.set(word, entry);
      persist(entry);
    }
    if (!progress) return;
    set(graduated
      ? { progress, ...withSets(get, get().stats, progress, get().learningSize, get().upcoming) }
      : { progress });
  },

  peek: (word) => {
    const previous = get().progress.get(word);
    if (!previous || previous.status !== 'learning' || previous.exposures < HINT_EXPOSURES) return;
    const progress = new Map(get().progress);
    const entry: WordProgress = {
      ...previous,
      exposures: HINT_EXPOSURES - HINT_AGAIN_AFTER_PEEK,
      streak: 0,
      updatedAt: Date.now(),
    };
    progress.set(word, entry);
    persist(entry);
    set({ progress });
  },

  reloadProgress: async () => {
    const rows = await db.wordProgress.toArray();
    const progress = new Map(rows.map(row => [row.word, row]));
    set({ progress, ...withSets(get, get().stats, progress, get().learningSize, get().upcoming) });
  },

  reloadSettings: () => {
    const size = readLearningSize();
    if (size !== get().learningSize) set({ learningSize: size, ...withSets(get, get().stats, get().progress, size, get().upcoming) });
  },

  setReadingChapter: async (chapterIndex) => {
    const { bookId, index, upcomingFrom, upcoming } = get();
    if (!bookId || !index || chapterIndex < 0) return;
    // Recount when the reader has moved a few chapters (or jumped).
    if (upcoming && chapterIndex >= upcomingFrom && chapterIndex < upcomingFrom + 3) return;
    const session = initSession;
    set({ upcomingFrom: chapterIndex });
    const counts = await countUpcomingWords(bookId, chapterIndex, index);
    if (session !== initSession || get().bookId !== bookId || get().upcomingFrom !== chapterIndex) return;
    set({ upcoming: counts, ...withSets(get, get().stats, get().progress, get().learningSize, counts) });
  },

  setSessionStart: (position) => set({ sessionStart: position, visibleFrom: new Map() }),

  openCard: (card) => set({ card }),
  closeCard: () => set({ card: null }),

  showsHint: (word) => {
    const { learning, progress } = get();
    if (!learning.has(word)) return false;
    return (progress.get(word)?.exposures ?? 0) < HINT_EXPOSURES;
  },
}));
