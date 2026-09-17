import React, { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Type, List, Bookmark } from 'lucide-react';
import { useReaderStore } from '../../stores/readerStore';
import { toggleBookmark } from '../bookmarks/bookmarkService';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import styles from './ReaderTopBar.module.css';

export const ReaderTopBar: React.FC = () => {
  const { isTopBarVisible, bookId, bookTitle, chapters, currentChapterIndex, toggleSettings, toggleContents, currentSentenceId, chapterSentences } = useReaderStore();
  const navigate = useNavigate();

  const currentChapter = chapters[currentChapterIndex];

  const isBookmarked = useLiveQuery(() => {
    if (!currentSentenceId) return false;
    return db.bookmarks.where('sentenceId').equals(currentSentenceId).count().then(c => c > 0);
  }, [currentSentenceId]);

  const handleBookmarkToggle = () => {
    if (!bookId || !currentChapter || !currentSentenceId) return;
    const sentences = chapterSentences[currentChapter.id];
    const sentence = sentences?.find(s => s.id === currentSentenceId);
    const previewText = sentence?.chineseText || 'No preview available';
    
    toggleBookmark(
      bookId,
      bookTitle,
      currentChapter.id,
      currentChapter.title,
      currentChapterIndex,
      currentSentenceId,
      previewText
    );
  };

  return (
    <div className={`${styles.topBar} ${!isTopBarVisible ? styles.hidden : ''}`}>
      <div className={styles.left}>
        <Link to="/" className={styles.backLink}>
          <ArrowLeft size={20} />
        </Link>
        <button className={`${styles.iconBtn} ${styles.menuBtn}`} onClick={toggleContents} aria-label="Toggle contents">
          <List size={20} />
        </button>
        <div className={styles.titleArea}>
          <div className={styles.bookTitle}>{bookTitle}</div>
          {currentChapter && (
            <div className={styles.chapterName}>{currentChapter.title}</div>
          )}
        </div>
      </div>
      <div className={styles.right}>
        <button className={styles.iconBtn} onClick={handleBookmarkToggle} aria-label="Bookmark">
          <Bookmark size={20} fill={isBookmarked ? 'currentColor' : 'none'} />
        </button>
        <button className={styles.iconBtn} onClick={toggleSettings} aria-label="Settings">
          <Type size={20} />
        </button>
      </div>
    </div>
  );
};
