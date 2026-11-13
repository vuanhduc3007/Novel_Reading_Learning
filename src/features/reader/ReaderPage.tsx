import React, { useEffect, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useReaderStore } from '../../stores/readerStore';
import { useDictionaryStore } from '../../stores/dictionaryStore';
import { useAutoHide } from '../../hooks/useAutoHide';
import { ReaderTopBar } from './ReaderTopBar';
import { ChapterList } from './ChapterList';
import { ReaderContent } from './ReaderContent';
import { ReaderProgressBar } from './ReaderProgressBar';
import { ReaderSettingsPanel } from './ReaderSettingsPanel';
import { DictionaryTooltip } from '../dictionary/DictionaryTooltip';
import { DictionaryPanel } from '../dictionary/DictionaryPanel';
import { WordCard } from '../immersion/WordCard';
import { useImmersionStore } from '../../stores/immersionStore';
import { Skeleton, ErrorBanner } from '../../components';
import { useTranslationScheduler } from '../translation/useTranslationScheduler';
import { translationQueue } from '../translation/translationQueue';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import styles from './ReaderPage.module.css';

export const ReaderPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const [searchParams] = useSearchParams();
  const jumpChapter = searchParams.get('jumpToChapter');
  const jumpSentence = searchParams.get('jumpToSentence');
  
  useTranslationScheduler();
  useKeyboardShortcuts();

  const {
    initializeReader,
    cleanup,
    isLoading,
    loadError,
    setTopBarVisible,
    jumpToLocation
  } = useReaderStore();

  const readingMode = useReaderStore(s => s.readingMode);
  const { isVisible, show } = useAutoHide(3000);

  // Vietnamese-first reading needs the Hán-Việt table and word statistics.
  useEffect(() => {
    if (bookId && !isLoading && readingMode === 'vietnamese_first') void useImmersionStore.getState().init(bookId);
  }, [bookId, isLoading, readingMode]);
  useEffect(() => () => useImmersionStore.getState().closeCard(), [bookId]);

  useEffect(() => {
    setTopBarVisible(isVisible);
  }, [isVisible, setTopBarVisible]);

  useEffect(() => {
    if (bookId) {
      initializeReader(bookId);
    }
    return () => {
      if (bookId) translationQueue.stopForReader(bookId);
      useDictionaryStore.getState().handleWordLeave();
      useDictionaryStore.getState().closePanel();
      cleanup();
    };
  }, [bookId, initializeReader, cleanup]);

  useEffect(() => {
    if (!isLoading && jumpChapter && jumpSentence) {
      const chapterIndex = Number(jumpChapter);
      if (Number.isInteger(chapterIndex) && chapterIndex >= 0) {
        jumpToLocation(chapterIndex, jumpSentence);
      }
    }
  }, [isLoading, jumpChapter, jumpSentence, jumpToLocation]);

  const handleMouseMove = useCallback(() => {
    show();
  }, [show]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleMouseMove);
    };
  }, [handleMouseMove]);

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <Skeleton width="60%" height="32px" />
        <Skeleton width="40%" height="24px" />
        <Skeleton width="80%" height="20px" />
        <Skeleton width="90%" height="20px" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.errorContainer}>
        <h2>Lỗi khi tải sách</h2>
        <p>{loadError}</p>
        <Link to="/" className={styles.backLink}>Quay lại Library</Link>
      </div>
    );
  }

  return (
    <div className={styles.reader} onMouseMove={handleMouseMove} onWheel={handleMouseMove}>
      <ReaderTopBar />
      <div className={styles.body}>
        <ChapterList />
        <div className={styles.readingPaneWrapper} id="reader-scroll-container" onScroll={handleMouseMove}>
          <ReaderContent />
        </div>
      </div>
      <ReaderProgressBar />
      <ReaderSettingsPanel />
      <DictionaryTooltip />
      <DictionaryPanel />
      <WordCard />
    </div>
  );
};
