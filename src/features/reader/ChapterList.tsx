import React, { useEffect, useState } from 'react';
import { List, X } from 'lucide-react';
import { useReaderStore } from '../../stores/readerStore';
import styles from './ChapterList.module.css';

export const ChapterList: React.FC = () => {
  const { chapters, currentChapterIndex, jumpToLocation, isContentsOpen, toggleContents } = useReaderStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleChapterClick = (index: number) => {
    jumpToLocation(index);
    if (isMobile) {
      toggleContents();
    }
  };

  const isCollapsed = !isContentsOpen && !isMobile;
  const isOverlay = isMobile;
  const showSidebar = !isMobile || isContentsOpen;

  if (!showSidebar && isMobile) return null;

  return (
    <>
      {isOverlay && isContentsOpen && (
        <div className={styles.backdrop} onClick={toggleContents} />
      )}
      <div className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''} ${isOverlay ? styles.overlay : ''}`}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Mục lục</span>
          <button className={styles.toggleBtn} onClick={toggleContents} aria-label="Toggle contents">
            {isOverlay ? <X size={20} /> : <List size={20} />}
          </button>
        </div>
        <div className={styles.list}>
          {chapters.map((chapter, index) => (
            <button
              key={chapter.id}
              className={`${styles.chapterItem} ${index === currentChapterIndex ? styles.active : ''}`}
              onClick={() => handleChapterClick(index)}
              aria-label={`Chương ${index + 1}: ${chapter.title}`}
            >
              <span className={styles.chapterIndex}>{index + 1}</span>
              <span className={styles.chapterTitle}>{chapter.title}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
};
