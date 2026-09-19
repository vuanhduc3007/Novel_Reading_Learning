import { db } from '../../db/database';
import { generateId } from '../../utils/id';

export async function toggleBookmark(bookId: string, bookTitle: string, chapterId: string, chapterTitle: string, chapterIndex: number, sentenceId: string, previewText: string) {
  // Serialize the read/modify/write sequence, including rapid double clicks.
  return db.transaction('rw', db.bookmarks, async () => {
    const existing = await db.bookmarks.where('sentenceId').equals(sentenceId).first();
    if (existing) {
      await db.bookmarks.delete(existing.id);
    } else {
      await db.bookmarks.add({
        id: generateId(),
        bookId, bookTitle, chapterId, chapterTitle, chapterIndex, sentenceId, previewText,
        createdAt: Date.now()
      });
    }
  });
}
