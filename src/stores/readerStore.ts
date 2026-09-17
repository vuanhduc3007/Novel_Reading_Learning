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
  lineHeightMultiplier: Number(localStorage.getItem('reader-line-height')) || 1.0,
  jumpTargetChapterIndex: null,
  jumpTargetSentenceId: null,

  initializeReader: async (bookId) => {
    set({ isLoading: true, loadError: null, bookId });
    try {
      const book = await db.books.get(bookId);
      if (!book) {
        set({ isLoading: false, loadError: 'Sách không tìm thấy' });
        return;
      }

      // Load chapter list (metadata only)
      const chapters = await db.chapters
        .where('bookId').equals(bookId)
        .sortBy('index');

      if (chapters.length === 0) {
        set({ isLoading: false, loadError: 'Sách không có chương nào' });
        return;
      }

      // Count total sentences
      const totalSentences = await db.sentences
        .where('bookId').equals(bookId)
        .count();

      // Determine starting chapter from saved position
      const startChapter = Math.min(
        book.lastReadChapterIndex || 0,
        chapters.length - 1
      );

      // Load reader settings from localStorage
      const savedMode = localStorage.getItem('reader-mode') as ReadingMode | null;
      const savedSize = localStorage.getItem('reader-size') as ReadingSize | null;
      const readingMode = savedMode || 'bilingual';
      const readingSize = savedSize || 'L';

      // Update lastOpenedAt
      await db.books.update(bookId, { lastOpenedAt: Date.now() });

      set({
        bookTitle: book.title,
        bookAuthor: book.author,
        chapters,
        totalSentences,
        currentChapterIndex: startChapter,
        currentSentenceId: book.lastReadSentenceId,
        readingProgress: book.readingProgress || 0,
        readingMode,
        readingSize,
        readingSizeValues: READING_SIZES[readingSize],
        lineHeightMultiplier: Number(localStorage.getItem('reader-line-height')) || 1.0,
        isLoading: false,
        isContentsOpen: window.innerWidth >= 1280,
      });

      // Preload starting chapter and neighbors
      const state = get();
      const startId = chapters[startChapter]?.id;
      if (startId) await state.loadChapterSentences(startId);

      // Load adjacent chapters
      if (startChapter > 0) {
        const prevId = chapters[startChapter - 1]?.id;
        if (prevId) state.loadChapterSentences(prevId);
      }
      if (startChapter < chapters.length - 1) {
        const nextId = chapters[startChapter + 1]?.id;
        if (nextId) state.loadChapterSentences(nextId);
      }
    } catch (error: any) {
      set({ isLoading: false, loadError: error.message || 'Lỗi khi tải sách' });
    }
  },

  loadChapterSentences: async (chapterId) => {
    const state = get();
    if (state.chapterSentences[chapterId] || state.loadingChapterIds.includes(chapterId)) return;

    set({ loadingChapterIds: [...state.loadingChapterIds, chapterId] });
    try {
      const sentences = await db.sentences
        .where('[chapterId+index]')
        .between([chapterId, 0], [chapterId, Infinity])
        .toArray();

      set((s) => ({
        chapterSentences: { ...s.chapterSentences, [chapterId]: sentences },
        loadingChapterIds: s.loadingChapterIds.filter(id => id !== chapterId),
      }));
    } catch {
      set((s) => ({
        loadingChapterIds: s.loadingChapterIds.filter(id => id !== chapterId),
      }));
    }
  },

  unloadChapter: (chapterId) => {
    set((s) => {
      const { [chapterId]: _, ...rest } = s.chapterSentences;
      return { chapterSentences: rest };
    });
  },

  setCurrentChapter: (index) => {
    const state = get();
    if (index === state.currentChapterIndex) return;
    set({ currentChapterIndex: index });

    // Calculate reading progress
    const progress = state.chapters.length > 0
      ? Math.round(((index + 1) / state.chapters.length) * 100)
      : 0;
    set({ readingProgress: progress });

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
    set({ currentSentenceId: sentenceId });
  },

  updateChapterHeight: (chapterId, height) => {
    set((s) => ({
      chapterHeights: { ...s.chapterHeights, [chapterId]: height },
    }));
  },

  setReadingMode: (mode) => {
    set({ readingMode: mode });
    localStorage.setItem('reader-mode', mode);
  },

  setReadingSize: (size) => {
    set({ readingSize: size, readingSizeValues: READING_SIZES[size] });
    localStorage.setItem('reader-size', size);
  },

  setLineHeightMultiplier: (mult) => {
    set({ lineHeightMultiplier: mult });
    localStorage.setItem('reader-line-height', String(mult));
  },

  toggleContents: () => set((s) => ({ isContentsOpen: !s.isContentsOpen })),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  setTopBarVisible: (v) => set({ isTopBarVisible: v }),

  jumpToLocation: (index, sentenceId) => {
    const state = get();
    const { chapters } = state;
    if (index < 0 || index >= chapters.length) return;

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
    const { bookId, currentChapterIndex, currentSentenceId, readingProgress } = get();
    if (!bookId) return;
    try {
      await db.books.update(bookId, {
        lastReadChapterIndex: currentChapterIndex,
        lastReadSentenceId: currentSentenceId,
        readingProgress,
      });
    } catch { /* ignore save errors */ }
  },

  updateSentenceInStore: (chapterId, sentenceId, updates) => {
    set((state) => {
      const sentences = state.chapterSentences[chapterId];
      if (!sentences) return state;
      
      const newSentences = sentences.map(s => 
        s.id === sentenceId ? { ...s, ...updates } : s
      );
      
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
