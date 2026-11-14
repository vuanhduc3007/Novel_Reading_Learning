import { db } from '../../db/database';
import { generateId } from '../../utils/id';
import { markDirty } from '../sync/localChanges';

export async function toggleBookmark(bookId: string, bookTitle: string, chapterId: string, chapterTitle: string, chapterIndex: number, sentenceId: string, previewText: string) {
  // Serialize the read/modify/write sequence, including rapid double clicks.
  const changedId = await db.transaction('rw', db.bookmarks, async () => {
    const existing = await db.bookmarks.where('sentenceId').equals(sentenceId).first();
    if (existing) {
      await db.bookmarks.delete(existing.id);
      return existing.id;
    }
    const id = generateId();
    await db.bookmarks.add({
      id,
      bookId, bookTitle, chapterId, chapterTitle, chapterIndex, sentenceId, previewText,
      createdAt: Date.now()
    });
    return id;
  });
  markDirty('bookmark', changedId);
}
