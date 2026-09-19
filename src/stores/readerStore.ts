import { create } from 'zustand';
import { db } from '../db/database';
import type { Book, Chapter, Sentence, ReadingMode, ReadingSize } from '../types';

const READING_SIZES: Record<ReadingSize, { cnSize: number; cnLh: number; viSize: number; viLh: number }> = {
  S:   { cnSize: 17, cnLh: 1.9, viSize: 13, viLh: 1.6 },
  M:   { cnSize: 19, cnLh: 1.9, viSize: 14, viLh: 1.6 },
  L:   { cnSize: 21, cnLh: 1.9, viSize: 15, viLh: 1.6 },
  XL:  { cnSize: 24, cnLh: 1.85, viSize: 17, viLh: 1.55 },
  XXL: { cnSize: 28, cnLh: 1.8, viSize: 19, viLh: 1.5 },
};

const READING_MODES: readonly ReadingMode[] = ['bilingual', 'chinese_only', 'on_demand'];
const READING_SIZE_KEYS: readonly ReadingSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

// A route change and React StrictMode can overlap IndexedDB reads. A monotonically
// increasing session makes late results from an old reader instance harmless.
let readerSession = 0;

function readStoredReadingMode(): ReadingMode {
  const value = typeof window === 'undefined' ? null : localStorage.getItem('reader-mode');
  return READING_MODES.includes(value as ReadingMode) ? value as ReadingMode : 'bilingual';
}

function readStoredReadingSize(): ReadingSize {
  const value = typeof window === 'undefined' ? null : localStorage.getItem('reader-size');
  return READING_SIZE_KEYS.includes(value as ReadingSize) ? value as ReadingSize : 'L';
}

function readStoredLineHeight(): number {
  const value = typeof window === 'undefined' ? null : Number(localStorage.getItem('reader-line-height'));
  return value === 1 || value === 1.2 || value === 1.5 ? value : 1;
}

interface ReaderState {
  // Book context
  bookId: string | null;
  bookTitle: string;
  bookAuthor: string;
  chapters: Chapter[];    // chapter metadata list (no sentences)
  totalSentences: number;
  isLoading: boolean;
  loadError: string | null;

  // Reading position
  currentChapterIndex: number;
  currentSentenceId: string | null;
  readingProgress: number; // 0-100

  // Chapter data cache: chapterId -> Sentence[]
  chapterSentences: Record<string, Sentence[]>;
  loadingChapterIds: string[];

  // Chapter heights for virtualization placeholders
  chapterHeights: Record<string, number>;

  // UI state
  isContentsOpen: boolean;
  isSettingsOpen: boolean;
  isTopBarVisible: boolean;

  // Reader settings (persisted)
  readingMode: ReadingMode;
  readingSize: ReadingSize;
  readingSizeValues: { cnSize: number; cnLh: number; viSize: number; viLh: number };
  lineHeightMultiplier: number;

  // Scroll jump target (for chapter jumps from Contents)
  jumpTargetChapterIndex: number | null;
  jumpTargetSentenceId: string | null;

  // Actions
  initializeReader: (bookId: string) => Promise<void>;
  loadChapterSentences: (chapterId: string) => Promise<void>;
  unloadChapter: (chapterId: string) => void;
  setCurrentChapter: (index: number) => void;
  setCurrentSentence: (sentenceId: string) => void;
  updateChapterHeight: (chapterId: string, height: number) => void;
  setReadingMode: (mode: ReadingMode) => void;
  setReadingSize: (size: ReadingSize) => void;
  setLineHeightMultiplier: (mult: number) => void;
  toggleContents: () => void;
  toggleSettings: () => void;
  setTopBarVisible: (v: boolean) => void;
  jumpToLocation: (chapterIndex: number, sentenceId?: string) => void;
  clearJumpTarget: () => void;
  saveReadingPosition: () => Promise<void>;
  updateSentenceInStore: (chapterId: string, sentenceId: string, updates: Partial<Sentence>) => void;
  cleanup: () => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  // Initial values
  bookId: null,
  bookTitle: '',
  bookAuthor: '',
  chapters: [],
  totalSentences: 0,
  isLoading: true,
  loadError: null,
  currentChapterIndex: 0,
  currentSentenceId: null,
  readingProgress: 0,
  chapterSentences: {},
  loadingChapterIds: [],
  chapterHeights: {},
  isContentsOpen: true,
  isSettingsOpen: false,
  isTopBarVisible: true,
  readingMode: 'bilingual',
  readingSize: 'L',
  readingSizeValues: READING_SIZES['L'],
  lineHeightMultiplier: readStoredLineHeight(),
  jumpTargetChapterIndex: null,
  jumpTargetSentenceId: null,

  initializeReader: async (bookId) => {
    const session = ++readerSession;
    set({
      bookId,
      bookTitle: '',
      bookAuthor: '',
      chapters: [],
      totalSentences: 0,
      currentChapterIndex: 0,
      currentSentenceId: null,
      readingProgress: 0,
      chapterSentences: {},
      loadingChapterIds: [],
      chapterHeights: {},
      jumpTargetChapterIndex: null,
      jumpTargetSentenceId: null,
      isLoading: true,
      loadError: null,
    });
    try {
      const book = await db.books.get(bookId);
      if (session !== readerSession) return;
      if (!book) {
        set({ isLoading: false, loadError: 'Sách không tìm thấy' });
        return;
      }

      // Load chapter list (metadata only)
      const chapters = await db.chapters
        .where('bookId').equals(bookId)
        .sortBy('index');
      if (session !== readerSession) return;

      if (chapters.length === 0) {
        set({ isLoading: false, loadError: 'Sách không có chương nào' });
        return;
      }

      // Count total sentences
      const totalSentences = await db.sentences
        .where('bookId').equals(bookId)
        .count();
      if (session !== readerSession) return;

      // Determine starting chapter from saved position
      const startChapter = Math.max(0, Math.min(book.lastReadChapterIndex || 0, chapters.length - 1));
      const savedProgress = Number.isFinite(book.readingProgress)
        ? Math.min(Math.max(book.readingProgress, 0), 100)
        : 0;

      // Load reader settings from localStorage
      const readingMode = readStoredReadingMode();
      const readingSize = readStoredReadingSize();

      // Update lastOpenedAt
      await db.books.update(bookId, { lastOpenedAt: Date.now() });
      if (session !== readerSession) return;

      set({
        bookTitle: book.title,
        bookAuthor: book.author,
        chapters,
        totalSentences,
        currentChapterIndex: startChapter,
        currentSentenceId: book.lastReadSentenceId,
        readingProgress: savedProgress,
        readingMode,
        readingSize,
        readingSizeValues: READING_SIZES[readingSize],
        lineHeightMultiplier: readStoredLineHeight(),
        isLoading: false,
        isContentsOpen: window.innerWidth >= 1280,
      });

      // Preload starting chapter and neighbors
      const state = get();
      const startId = chapters[startChapter]?.id;
      if (startId) await state.loadChapterSentences(startId);
      if (session !== readerSession) return;
      if (!get().currentSentenceId && get().currentChapterIndex === startChapter && startId) {
        const firstSentence = get().chapterSentences[startId]?.[0];
        if (firstSentence) set({ currentSentenceId: firstSentence.id });
      }

      // Load adjacent chapters
      if (startChapter > 0) {
        const prevId = chapters[startChapter - 1]?.id;
        if (prevId) state.loadChapterSentences(prevId);
      }
      if (startChapter < chapters.length - 1) {
        const nextId = chapters[startChapter + 1]?.id;
        if (nextId) state.loadChapterSentences(nextId);
      }
    } catch (error: unknown) {
      if (session !== readerSession) return;
      const message = error instanceof Error ? error.message : 'Lỗi khi tải sách';
      set({ isLoading: false, loadError: message });
    }
  },

  loadChapterSentences: async (chapterId) => {
    const state = get();
    if (state.chapterSentences[chapterId] || state.loadingChapterIds.includes(chapterId)) return;

    const session = readerSession;
    const bookId = state.bookId;
    if (!bookId || !state.chapters.some(chapter => chapter.id === chapterId)) return;

    set({ loadingChapterIds: [...state.loadingChapterIds, chapterId] });
    try {
      const sentences = await db.sentences
        .where('[chapterId+index]')
        .between([chapterId, 0], [chapterId, Infinity])
        .toArray();

      if (session !== readerSession || get().bookId !== bookId) return;

      set((s) => {
        const index = s.chapters.findIndex(chapter => chapter.id === chapterId);
        // A preload may finish after navigation has evicted its window.
        // Do not repopulate distant chapters with that stale result.
        const inWindow = index >= 0 && Math.abs(index - s.currentChapterIndex) <= 2;
        return {
          chapterSentences: inWindow ? { ...s.chapterSentences, [chapterId]: sentences } : s.chapterSentences,
          loadingChapterIds: s.loadingChapterIds.filter(id => id !== chapterId),
        };
      });
    } catch {
      if (session !== readerSession || get().bookId !== bookId) return;
      set((s) => ({
        loadingChapterIds: s.loadingChapterIds.filter(id => id !== chapterId),
      }));
    }
  },

  unloadChapter: (chapterId) => {
    set((s) => {
      if (!s.chapterSentences[chapterId]) return s;
      const { [chapterId]: _, ...rest } = s.chapterSentences;
      return { chapterSentences: rest };
    });
  },

  setCurrentChapter: (index) => {
    const state = get();
    if (!Number.isInteger(index) || index < 0 || index >= state.chapters.length || index === state.currentChapterIndex) return;

    // Calculate reading progress
    const progress = state.chapters.length > 0
      ? Math.round(((index + 1) / state.chapters.length) * 100)
      : 0;
    set({ currentChapterIndex: index, readingProgress: progress });

    // Preload adjacent chapters
    const { chapters } = state;
    if (index > 0) {
      const prevId = chapters[index - 1]?.id;
      if (prevId) state.loadChapterSentences(prevId);
    }
    if (index < chapters.length - 1) {
      const nextId = chapters[index + 1]?.id;
      if (nextId) state.loadChapterSentences(nextId);
    }
    // Current chapter
    const curId = chapters[index]?.id;
    if (curId) state.loadChapterSentences(curId);

    // Unload far chapters (keep current ± 2 for buffer)
    for (const loadedId of Object.keys(state.chapterSentences)) {
      const loadedIndex = chapters.findIndex(c => c.id === loadedId);
      if (loadedIndex >= 0 && Math.abs(loadedIndex - index) > 2) {
        state.unloadChapter(loadedId);
      }
    }
  },

  setCurrentSentence: (sentenceId) => {
    set((state) => state.currentSentenceId === sentenceId ? state : { currentSentenceId: sentenceId });
  },

  updateChapterHeight: (chapterId, height) => {
    if (!Number.isFinite(height) || height < 0) return;
    set((s) => {
      if (s.chapterHeights[chapterId] === height) {
        return s;
      }
      return {
        chapterHeights: { ...s.chapterHeights, [chapterId]: height },
      };
    });
  },

  setReadingMode: (mode) => {
    if (!READING_MODES.includes(mode)) return;
    set({ readingMode: mode });
    localStorage.setItem('reader-mode', mode);
  },

  setReadingSize: (size) => {
    if (!READING_SIZE_KEYS.includes(size)) return;
    set({ readingSize: size, readingSizeValues: READING_SIZES[size] });
    localStorage.setItem('reader-size', size);
  },

  setLineHeightMultiplier: (mult) => {
    if (mult !== 1 && mult !== 1.2 && mult !== 1.5) return;
    set({ lineHeightMultiplier: mult });
    localStorage.setItem('reader-line-height', String(mult));
  },

  toggleContents: () => set((s) => ({ isContentsOpen: !s.isContentsOpen })),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  setTopBarVisible: (v) => set((state) => state.isTopBarVisible === v ? state : { isTopBarVisible: v }),

  jumpToLocation: (index, sentenceId) => {
    const state = get();
    const { chapters } = state;
    if (!Number.isInteger(index) || index < 0 || index >= chapters.length) return;

    set({
      currentChapterIndex: index,
      jumpTargetChapterIndex: index,
      jumpTargetSentenceId: sentenceId || null,
      readingProgress: Math.round(((index + 1) / chapters.length) * 100),
    });

    // Load target chapter and neighbors
    const curId = chapters[index]?.id;
    if (curId) state.loadChapterSentences(curId);
    if (index > 0) {
      const prevId = chapters[index - 1]?.id;
      if (prevId) state.loadChapterSentences(prevId);
    }
    if (index < chapters.length - 1) {
      const nextId = chapters[index + 1]?.id;
      if (nextId) state.loadChapterSentences(nextId);
    }

    // Unload far chapters
    for (const loadedId of Object.keys(state.chapterSentences)) {
      const loadedIndex = chapters.findIndex(c => c.id === loadedId);
      if (loadedIndex >= 0 && Math.abs(loadedIndex - index) > 2) {
        state.unloadChapter(loadedId);
      }
    }
  },

  clearJumpTarget: () => set({ jumpTargetChapterIndex: null, jumpTargetSentenceId: null }),

  saveReadingPosition: async () => {
    const { bookId, currentChapterIndex, currentSentenceId, readingProgress, isLoading, loadError, chapters } = get();
    // StrictMode and fast navigation can clean up an unfinished initialization.
    // Its placeholder position must never overwrite the last persisted position.
    if (!bookId || isLoading || loadError || chapters.length === 0) return;
    try {
      await db.books.update(bookId, {
        lastReadChapterIndex: currentChapterIndex,
        lastReadSentenceId: currentSentenceId,
        readingProgress,
      });
    } catch (error) {
      console.error('Failed to save reading position', error);
    }
  },

  updateSentenceInStore: (chapterId, sentenceId, updates) => {
    set((state) => {
      const sentences = state.chapterSentences[chapterId];
      if (!sentences) return state;
      
      const newSentences = sentences.map(s => 
        s.id === sentenceId ? { ...s, ...updates } : s
      );
      if (newSentences.every((sentence, index) => sentence === sentences[index])) return state;
      
      return {
        chapterSentences: {
          ...state.chapterSentences,
          [chapterId]: newSentences
        }
      };
    });
  },

  cleanup: () => {
    // Save final position before cleanup
    const state = get();
    state.saveReadingPosition();
    readerSession++;
    set({
      bookId: null,
      bookTitle: '',
      bookAuthor: '',
      chapters: [],
      totalSentences: 0,
      isLoading: true,
      loadError: null,
      currentChapterIndex: 0,
      currentSentenceId: null,
      readingProgress: 0,
      chapterSentences: {},
      loadingChapterIds: [],
      chapterHeights: {},
      jumpTargetChapterIndex: null,
      jumpTargetSentenceId: null,
      isSettingsOpen: false,
    });
  },
}));
