import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { useNavigate } from 'react-router-dom';
import styles from './BookmarksPage.module.css';
import { ArrowLeft, Trash2 } from 'lucide-react';

export const BookmarksPage: React.FC = () => {
  const bookmarks = useLiveQuery(() => db.bookmarks.orderBy('createdAt').reverse().toArray());
  const navigate = useNavigate();

  const handleBookmarkClick = (bookmark: any) => {
    navigate(`/reader/${bookmark.bookId}?jumpToSentence=${bookmark.sentenceId}&jumpToChapter=${bookmark.chapterIndex}`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await db.bookmarks.delete(id);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={24} />
        </button>
        <h1>Bookmarks</h1>
      </div>
      
      {bookmarks === undefined ? (
        <div className={styles.loading}>Loading...</div>
      ) : bookmarks.length === 0 ? (
        <div className={styles.empty}>No bookmarks yet.</div>
      ) : (
        <div className={styles.list}>
          {bookmarks.map(bookmark => (
            <div key={bookmark.id} className={styles.card} onClick={() => handleBookmarkClick(bookmark)}>
              <div className={styles.cardHeader}>
                <div className={styles.bookInfo}>
                  <span className={styles.bookTitle}>{bookmark.bookTitle}</span>
                  <span className={styles.chapterTitle}>- {bookmark.chapterTitle}</span>
                </div>
                <button className={styles.deleteBtn} onClick={(e) => handleDelete(e, bookmark.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
              <div className={styles.preview}>{bookmark.previewText}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
