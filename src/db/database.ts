import Dexie, { type Table } from 'dexie';
import type { Book, Chapter, Sentence, VocabularyItem, Bookmark, DictionaryCacheEntry } from '../types';

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
  }
}

export const db = new ChineseReaderDB();
