// ============================================
// Chinese Reader — Shared Types
// Based on Design Spec v1.1, Section 17.1
// ============================================

// === Book ===

export type SourceFormat = 'epub' | 'txt' | 'html' | 'md';

export type ImportStatus =
  | 'uploading'
  | 'parsing'
  | 'extracting'
  | 'processing'
  | 'ready_to_read'
  | 'failed'
  | 'unavailable';

export type TranslationStatus = 'not_translated' | 'translating' | 'ready' | 'failed';

export interface Book {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  sourceFormat: SourceFormat;
  fileSizeBytes: number;
  importStatus: ImportStatus;
  translationProgress: number; // 0–100
  readingProgress: number; // 0–100
  lastReadSentenceId: string | null;
  lastReadChapterIndex: number;
  lastOpenedAt: number | null; // timestamp
  createdAt: number; // timestamp
  chapterCount: number;
}

// === Chapter ===

export interface Chapter {
  id: string;
  bookId: string;
  index: number;
  title: string;
  sentenceCount: number;
}

// === Sentence ===

export interface Sentence {
  id: string;
  chapterId: string;
  bookId: string;
  index: number;
  chineseText: string;
  vietnameseText: string | null;
  translationStatus: TranslationStatus;
}

// === Dictionary ===

export type DictionarySource = 'local' | 'cache' | 'external' | 'llm';
export type DictionaryCompleteness = 'complete' | 'partial';

export interface DictionaryLookupResult {
  word: string;
  pinyin: string | null;
  meaning: string | null;
  partOfSpeech: string | null;
  examples: Array<{ chinese: string; vietnamese: string }>;
  relatedWords: string[];
  source: DictionarySource;
  completeness: DictionaryCompleteness;
  fetchedAt: number; // timestamp
}

export interface DictionaryCacheEntry {
  word: string;
  result: DictionaryLookupResult;
  cachedAt: number; // timestamp
}

// === Vocabulary ===

export interface VocabularyItem {
  id: string;
  word: string;
  pinyin: string;
  meaning: string;
  partOfSpeech: string | null;
  sourceBookId: string;
  sourceBookTitle: string;
  sourceBookAvailable: boolean;
  sourceSentenceId: string | null;
  isKnown: boolean;
  addedAt: number; // timestamp
}

// === Bookmark ===

export interface Bookmark {
  id: string;
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  sentenceId: string;
  previewText: string;
  createdAt: number; // timestamp
}

// === App Settings ===

export type ThemeMode = 'light' | 'dark' | 'system';
export type ReadingMode = 'bilingual' | 'chinese_only' | 'on_demand';
export type ChineseFont = 'serif' | 'sans';
export type ReadingSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';

export interface ReaderSettings {
  readingMode: ReadingMode;
  readingSize: ReadingSize;
  chineseFont: ChineseFont;
  lineHeightMultiplier: number; // 1.0 = default
  contentWidthPercent: number;  // 100 = full width
}

export interface AppSettings {
  theme: ThemeMode;
  readerSettings: ReaderSettings;
}

// === Sort ===

export type LibrarySortOption = 'recent' | 'newest' | 'last_opened';

// === Dictionary Panel State ===

export type DictionaryPanelState =
  | 'closed'
  | 'loading'
  | 'partial'
  | 'complete'
  | 'complete_ai'
  | 'unavailable'
  | 'error';
