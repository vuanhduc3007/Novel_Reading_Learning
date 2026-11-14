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
  /** Title of the imported human reference translation, if any. */
  referenceTitle?: string | null;
  /** Alignment algorithm version the reference was imported with. */
  referenceVersion?: number;
  /**
   * True when the book was imported without paragraph data and its sentences'
   * paragraph numbers were taken from an aligned reference translation.
   */
  paragraphsInferred?: boolean;
  /** When the reading position last changed on this device (ms). */
  progressUpdatedAt?: number;
  /** Storage paths of the original files once uploaded to the account. */
  cloudSourcePath?: string | null;
  cloudReferencePath?: string | null;
}

// === Cloud sync ===

/** Original file of a book (or its reference translation), kept for upload. */
export interface BookFile {
  bookId: string;
  kind: 'source' | 'reference';
  name: string;
  blob: Blob;
}

export type SyncKind = 'book' | 'progress' | 'word' | 'vocabulary' | 'bookmark' | 'settings';

/** Something changed locally and must be pushed; the current local state is sent. */
export interface SyncDirty {
  kind: SyncKind;
  key: string;
  at: number;
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
  translationErrorCode?: string | null;
  translationRetryAt?: number | null;
  /** Paragraph number inside the chapter (books imported after v1.1). */
  paragraphIndex?: number;
  /**
   * Aligned human reference translation. `undefined`/`null`: none.
   * Empty string: this sentence's meaning is carried by the next sentence's
   * reference text (the translator merged several source sentences).
   */
  referenceText?: string | null;
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

// === Immersion (Vietnamese-first reading) ===

export type WordLearningStatus = 'learning' | 'known' | 'ignored';

/** Learning state of one Chinese word in Vietnamese-first mode. */
export interface WordProgress {
  word: string;
  status: WordLearningStatus;
  /** Times the word was seen in Chinese while reading. Peeking lowers it. */
  exposures: number;
  updatedAt: number;
}

/** How often each matchable Chinese word occurs in a book, most frequent first. */
export interface BookWordStats {
  bookId: string;
  /** [Chinese word, occurrences, most common Vietnamese rendering]. */
  words: Array<[string, number, string]>;
  builtAt: number;
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
/**
 * - vietnamese_first: read the (human) Vietnamese translation; words being
 *   learned appear in Chinese inside it, more of them over time.
 * - on_demand: Chinese first, translation blurred until tapped.
 */
export type ReadingMode = 'vietnamese_first' | 'bilingual' | 'chinese_only' | 'on_demand';
export type ChineseFont = 'serif' | 'sans';
export type ContentWidth = 'narrow' | 'medium' | 'wide';
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
