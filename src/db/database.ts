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
  }
}

export const db = new ChineseReaderDB();
