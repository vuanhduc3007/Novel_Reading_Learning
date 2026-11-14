import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { markDirty } from '../sync/localChanges';
import { useNavigate } from 'react-router-dom';
import styles from './BookmarksPage.module.css';
import { ArrowLeft, Trash2 } from 'lucide-react';
import type { Sentence } from '../../types';

export const BookmarksPage: React.FC = () => {
  const bookmarks = useLiveQuery(() => db.bookmarks.orderBy('createdAt').reverse().toArray());
  // Show the sentence as it reads now: human translation first, then machine.
  const sentences = useLiveQuery(async () => {
    if (!bookmarks) return new Map<string, Sentence>();
    const rows = await db.sentences.bulkGet(bookmarks.map(bookmark => bookmark.sentenceId));
    return new Map(rows.filter((row): row is Sentence => Boolean(row)).map(row => [row.id, row]));
  }, [bookmarks]);
  const navigate = useNavigate();

  const handleBookmarkClick = (bookmark: any) => {
    navigate(`/reader/${bookmark.bookId}?jumpToSentence=${bookmark.sentenceId}&jumpToChapter=${bookmark.chapterIndex}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await db.bookmarks.delete(id);
    markDirty('bookmark', id);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={24} />
        </button>
        <h1>Dấu trang</h1>
      </div>
      
      {bookmarks === undefined ? (
        <div className={styles.loading}>Đang tải…</div>
      ) : bookmarks.length === 0 ? (
        <div className={styles.empty}>
          Chưa có dấu trang. Khi đang đọc, bấm biểu tượng 🔖 trên thanh trên cùng để đánh dấu câu ở đầu màn hình.
        </div>
      ) : (
        <div className={styles.list}>
          {bookmarks.map(bookmark => (
            <div key={bookmark.id} className={styles.card} onClick={() => handleBookmarkClick(bookmark)}>
              <div className={styles.cardHeader}>
                <div className={styles.bookInfo}>
                  <span className={styles.bookTitle}>{bookmark.bookTitle}</span>
                  <span className={styles.chapterTitle}>- {bookmark.chapterTitle}</span>
                </div>
                <button className={styles.deleteBtn} onClick={(e) => handleDelete(e, bookmark.id)} aria-label="Xoá dấu trang" title="Xoá dấu trang">
                  <Trash2 size={16} />
                </button>
              </div>
              {(() => {
                const sentence = sentences?.get(bookmark.sentenceId);
                const vietnamese = sentence?.referenceText || (sentence?.translationStatus === 'ready' ? sentence.vietnameseText : null);
                return (
                  <>
                    {vietnamese && <div className={styles.preview}>{vietnamese}</div>}
                    <div className={vietnamese ? styles.previewSecondary : styles.preview}>{sentence?.chineseText ?? bookmark.previewText}</div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
