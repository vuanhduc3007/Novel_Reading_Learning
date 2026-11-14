import { create } from 'zustand';
import { db } from '../db/database';
import { loadHanViet } from '../features/immersion/hanVietData';
import { buildBookWordStats } from '../features/immersion/wordStats';
import { markManyDirty, markSettingsChanged } from '../features/sync/localChanges';
import type { HanVietData, HanVietIndex, WordMatch } from '../features/immersion/wordMatcher';
import type { BookWordStats, WordLearningStatus, WordProgress } from '../types';

/**
 * Vietnamese-first reading ("diglot weave").
 *
 * The learner reads the Vietnamese translation. A small set of Chinese words
 * (the most frequent ones in the book that are not known yet) appear in
 * Chinese in place of their Vietnamese counterpart:
 *  - first with the Vietnamese meaning shown above them,
 *  - after enough encounters without it, so the reader must recall the
 *    meaning (tap to peek; peeking brings the hint back for a while),
 *  - once known (marked by the learner or after many encounters) they stay
 *    in Chinese for good and a new word takes the free slot.
 * Over time the text turns more and more Chinese at the learner's own pace.
 */

/** Encounters with the hint before it is removed (at most 3 count per chapter). */
export const HINT_EXPOSURES = 8;
/** Encounters after which a word counts as known automatically. */
export const AUTO_KNOWN_EXPOSURES = 40;
/** Peeking at a hidden meaning sets the word back this many encounters. */
const PEEK_PENALTY = 4;
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

  init: (bookId: string) => Promise<void>;
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

function computeSets(stats: BookWordStats | null, progress: Map<string, WordProgress>, size: number) {
  const known = new Set<string>();
  for (const entry of progress.values()) if (entry.status === 'known') known.add(entry.word);
  const learning = new Set<string>();
  // Words already started stay in the set even if the size was lowered, so
  // nothing disappears mid-way; new words fill free slots by frequency.
  const words = stats?.words ?? [];
  for (const [word] of words) {
    const entry = progress.get(word);
    if (entry?.status === 'learning' && entry.exposures > 0 && learning.size < size) learning.add(word);
  }
  for (const [word, count] of words) {
    if (learning.size >= size) break;
    if (count < MIN_OCCURRENCES) break;
    const status = progress.get(word)?.status;
    if (status === 'known' || status === 'ignored') continue;
    learning.add(word);
  }
  return { known, learning };
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

  init: async (bookId) => {
    const session = ++initSession;
    if (get().bookId !== bookId) set({ ready: false, bookId, stats: null, card: null });
    const [{ data, index }, rows, stats] = await Promise.all([
      loadHanViet(),
      db.wordProgress.toArray(),
      db.wordStats.get(bookId),
    ]);
    if (session !== initSession) return;
    const progress = new Map(rows.map(row => [row.word, row]));
    set({ data, index, progress, stats: stats ?? null, ready: true, ...computeSets(stats ?? null, progress, get().learningSize) });
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
      set({ stats, ...computeSets(stats, get().progress, get().learningSize) });
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
    set({ learningSize: size, ...computeSets(stats, progress, size) });
  },

  setStatus: (word, status) => {
    const progress = new Map(get().progress);
    const previous = progress.get(word);
    const entry: WordProgress = {
      word,
      status,
      // Moving a known word back to learning shows the hint again.
      exposures: status === 'learning' ? 0 : previous?.exposures ?? 0,
      updatedAt: Date.now(),
    };
    progress.set(word, entry);
    persist(entry);
    set({ progress, ...computeSets(get().stats, progress, get().learningSize) });
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
      const exposures = (previous?.exposures ?? 0) + 1;
      const status: WordLearningStatus = exposures >= AUTO_KNOWN_EXPOSURES ? 'known' : 'learning';
      if (status === 'known') graduated = true;
      const entry: WordProgress = { word, status, exposures, updatedAt: Date.now() };
      progress.set(word, entry);
      persist(entry);
    }
    if (!progress) return;
    set(graduated
      ? { progress, ...computeSets(get().stats, progress, get().learningSize) }
      : { progress });
  },

  peek: (word) => {
    const previous = get().progress.get(word);
    if (!previous || previous.status !== 'learning' || previous.exposures < HINT_EXPOSURES) return;
    const progress = new Map(get().progress);
    const entry: WordProgress = {
      ...previous,
      exposures: Math.max(0, previous.exposures - PEEK_PENALTY),
      updatedAt: Date.now(),
    };
    progress.set(word, entry);
    persist(entry);
    set({ progress });
  },

  reloadProgress: async () => {
    const rows = await db.wordProgress.toArray();
    const progress = new Map(rows.map(row => [row.word, row]));
    set({ progress, ...computeSets(get().stats, progress, get().learningSize) });
  },

  reloadSettings: () => {
    const size = readLearningSize();
    if (size !== get().learningSize) set({ learningSize: size, ...computeSets(get().stats, get().progress, size) });
  },

  openCard: (card) => set({ card }),
  closeCard: () => set({ card: null }),

  showsHint: (word) => {
    const { learning, progress } = get();
    if (!learning.has(word)) return false;
    return (progress.get(word)?.exposures ?? 0) < HINT_EXPOSURES;
  },
}));
