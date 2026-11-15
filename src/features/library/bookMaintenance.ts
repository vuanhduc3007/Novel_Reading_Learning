import { db } from '../../db/database';
import { yieldToMain } from '../../utils/yieldToMain';

/**
 * Removing a large book (300k+ sentences) takes over a minute in IndexedDB.
 * The book disappears from the library at once; its chapters and sentences
 * are removed afterwards in small batches. Interrupted cleanups (tab closed)
 * resume the next time the app starts.
 */

const BATCH = 5000;
let purging: Promise<void> | null = null;

async function purgeBook(bookId: string): Promise<void> {
  for (;;) {
    const keys = await db.sentences.where('bookId').equals(bookId).limit(BATCH).primaryKeys();
    if (keys.length === 0) break;
    await db.sentences.bulkDelete(keys);
    await yieldToMain();
  }
  await db.chapters.where('bookId').equals(bookId).delete();
}

/** Delete chapters and sentences whose book no longer exists. */
export function purgeOrphanedBookData(): Promise<void> {
  purging ??= (async () => {
    try {
      const books = new Set((await db.books.toCollection().primaryKeys()).map(String));
      const orphaned = new Set<string>();
      await db.chapters.each(chapter => {
        if (!books.has(chapter.bookId)) orphaned.add(chapter.bookId);
      });
      for (const bookId of orphaned) await purgeBook(bookId);
    } catch (error) {
      console.error('Cleaning up deleted books failed', error);
    } finally {
      purging = null;
    }
  })();
  return purging;
}

/**
 * Give a local book another id (and move everything that refers to it).
 * Used when the same file was imported separately on two devices before
 * signing in: the copy here takes the id the account already uses.
 */
export async function remapBookId(oldId: string, newId: string, onProgress?: (detail: string) => void): Promise<void> {
  if (oldId === newId) return;
  const book = await db.books.get(oldId);
  if (!book || await db.books.get(newId)) return;
  onProgress?.(`Đang liên kết "${book.title}" với tài khoản…`);
  // Sentences first, chapter by chapter (the reader looks them up by chapter,
  // so the book stays readable); chapters and the book record move together
  // at the end, so an interrupted remap leaves a consistent book.
  const chapterIds = await db.chapters.where('bookId').equals(oldId).primaryKeys();
  for (const chapterId of chapterIds) {
    await db.sentences.where('chapterId').equals(chapterId as string).modify({ bookId: newId });
    await yieldToMain();
  }
  await db.transaction('rw', [db.books, db.chapters, db.bookmarks, db.vocabularyItems, db.wordStats, db.bookFiles, db.syncDirty], async () => {
    await db.chapters.where('bookId').equals(oldId).modify({ bookId: newId });
    await db.books.add({ ...book, id: newId });
    await db.books.delete(oldId);
    await db.bookmarks.where('bookId').equals(oldId).modify({ bookId: newId });
    await db.vocabularyItems.where('sourceBookId').equals(oldId).modify({ sourceBookId: newId });
    const stats = await db.wordStats.get(oldId);
    if (stats) {
      await db.wordStats.put({ ...stats, bookId: newId });
      await db.wordStats.delete(oldId);
    }
    for (const file of await db.bookFiles.where('bookId').equals(oldId).toArray()) {
      await db.bookFiles.put({ ...file, bookId: newId });
      await db.bookFiles.delete([oldId, file.kind]);
    }
    for (const kind of ['book', 'progress'] as const) {
      const entry = await db.syncDirty.get([kind, oldId]);
      if (!entry) continue;
      await db.syncDirty.delete([kind, oldId]);
      // The old id never reached the account; only its progress matters now.
      if (kind === 'progress') await db.syncDirty.put({ ...entry, key: newId });
    }
  });
}
