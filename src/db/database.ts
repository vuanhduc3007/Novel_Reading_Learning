import Dexie, { type Table } from 'dexie';
import type { Book, Chapter, Sentence, VocabularyItem, Bookmark, DictionaryCacheEntry, ImportStatus } from '../types';

export class ChineseReaderDB extends Dexie {
  books!: Table<Book>;
  chapters!: Table<Chapter>;
  sentences!: Table<Sentence>;
  vocabularyItems!: Table<VocabularyItem>;
  bookmarks!: Table<Bookmark>;
  dictionaryCache!: Table<DictionaryCacheEntry>;

  constructor() {
    super('ChineseReaderDB');
    this.version(1).stores({
      books: 'id, importStatus, lastOpenedAt, createdAt',
      chapters: 'id, bookId, [bookId+index]',
      sentences: 'id, chapterId, bookId, [chapterId+index], [bookId+chapterId]',
      vocabularyItems: 'id, sourceBookId, word, addedAt',
      bookmarks: 'id, bookId, [bookId+chapterIndex]',
      dictionaryCache: 'word, cachedAt',
    });

    // Add sentenceId index to bookmarks for faster toggle/lookup
    this.version(2).stores({
      bookmarks: 'id, bookId, [bookId+chapterIndex], sentenceId',
    });
    // /bookmarks orders by creation time. Existing v2 databases also need
    // this migration; changing the already-released v2 schema is not enough.
    this.version(3).stores({
      bookmarks: 'id, bookId, [bookId+chapterIndex], sentenceId, createdAt',
    });

    // Imports are committed atomically as of v4. Remove only abandoned
    // transient records left by older versions (for example after a reload
    // during parsing), together with any partial book-scoped data. Vocabulary
    // is intentionally preserved.
    this.version(4).upgrade(async (transaction) => {
      const books = transaction.table<Book>('books');
      const chapters = transaction.table<Chapter>('chapters');
      const sentences = transaction.table<Sentence>('sentences');
      const bookmarks = transaction.table<Bookmark>('bookmarks');
      const vocabularyItems = transaction.table<VocabularyItem>('vocabularyItems');
      const transientStatuses: ImportStatus[] = ['uploading', 'parsing', 'extracting', 'processing'];
      const abandoned = await books.where('importStatus').anyOf(transientStatuses).toArray();

      for (const book of abandoned) {
        await sentences.where('bookId').equals(book.id).delete();
        await chapters.where('bookId').equals(book.id).delete();
        await bookmarks.where('bookId').equals(book.id).delete();
        await vocabularyItems.where('sourceBookId').equals(book.id).modify({ sourceBookAvailable: false });
        await books.delete(book.id);
      }
    });

    // Production builds previously defaulted to frontend mock providers when
    // their Vite environment was missing. Reset only those recognizable mock
    // artifacts so real translations can be requested after configuration is
    // corrected. All book data, progress, bookmarks and vocabulary remain.
    this.version(5).stores({
      sentences: 'id, chapterId, bookId, translationStatus, [chapterId+index], [bookId+chapterId]',
    }).upgrade(async (transaction) => {
      const sentences = transaction.table<Sentence>('sentences');
      const dictionaryCache = transaction.table<DictionaryCacheEntry>('dictionaryCache');
      // Keep the legacy marker available to the migration without shipping the
      // former mock provider's complete output prefix as a production literal.
      const legacyMockTranslationPrefix = ['[Bản dịch', 'Mock]'].join(' ');

      await sentences
        .where('translationStatus')
        .equals('ready')
        .filter((sentence) => sentence.vietnameseText?.startsWith(legacyMockTranslationPrefix) === true)
        .modify({ translationStatus: 'not_translated', vietnameseText: null });

      await dictionaryCache
        .filter((entry) => entry.result?.meaning?.startsWith('[Generated] Mock meaning') === true)
        .delete();
    });

    // The former backend dictionary mock was cached as a normal external
    // result. Remove only that recognizable output so the first full lookup
    // after enabling the real provider can refresh it. Other cache entries and
    // all user data remain untouched.
    this.version(6).upgrade(async (transaction) => {
      const dictionaryCache = transaction.table<DictionaryCacheEntry>('dictionaryCache');
      await dictionaryCache
        .filter((entry) => entry.result?.meaning?.startsWith('[Backend Generated] Mock meaning') === true)
        .delete();
    });
  }
}

export const db = new ChineseReaderDB();
