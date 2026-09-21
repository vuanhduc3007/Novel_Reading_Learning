import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { useReaderStore } from '../../stores/readerStore';
import { ChapterBlock } from './ChapterBlock';
import { Skeleton } from '../../components';
import styles from './ReaderContent.module.css';

// Throttle utility (inline)
type Throttled<T extends (...args: any[]) => void> = T & { cancel: () => void };

function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): Throttled<T> {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const throttled = ((...args: any[]) => {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, ms - (now - lastCall));
    }
  }) as Throttled<T>;
  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return throttled;
}

export function ReaderContent() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionRestoredRef = useRef(false);

  // Read store state (individual selectors to minimize re-renders)
  const chapters = useReaderStore(s => s.chapters);
  const bookId = useReaderStore(s => s.bookId);
  const currentChapterIndex = useReaderStore(s => s.currentChapterIndex);
  const chapterSentences = useReaderStore(s => s.chapterSentences);
  const loadingChapterIds = useReaderStore(s => s.loadingChapterIds);
  const chapterHeights = useReaderStore(s => s.chapterHeights);
  const readingMode = useReaderStore(s => s.readingMode);
  const readingSizeValues = useReaderStore(s => s.readingSizeValues);
  const lineHeightMultiplier = useReaderStore(s => s.lineHeightMultiplier);
  const jumpTargetChapterIndex = useReaderStore(s => s.jumpTargetChapterIndex);
  const jumpTargetSentenceId = useReaderStore(s => s.jumpTargetSentenceId);
  const currentSentenceId = useReaderStore(s => s.currentSentenceId);
  const initialPositionRef = useRef({ chapterIndex: currentChapterIndex, sentenceId: currentSentenceId });

  // Actions
  const loadChapterSentences = useReaderStore(s => s.loadChapterSentences);
  const setCurrentChapter = useReaderStore(s => s.setCurrentChapter);
  const setCurrentSentence = useReaderStore(s => s.setCurrentSentence);
  const updateChapterHeight = useReaderStore(s => s.updateChapterHeight);
  const saveReadingPosition = useReaderStore(s => s.saveReadingPosition);
  const clearJumpTarget = useReaderStore(s => s.clearJumpTarget);
  const setTopBarVisible = useReaderStore(s => s.setTopBarVisible);

  // ReaderPage is reused when only :bookId changes. Reset per-book refs so a
  // prior book cannot suppress restoration or a bookmark jump for the next one.
  useEffect(() => {
    positionRestoredRef.current = false;
    const state = useReaderStore.getState();
    initialPositionRef.current = { chapterIndex: state.currentChapterIndex, sentenceId: state.currentSentenceId };
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [bookId]);

  // Determine which chapters should be mounted (current ± 1)
  const mountedRange = useMemo(() => ({
    start: Math.max(0, currentChapterIndex - 1),
    end: Math.min(chapters.length - 1, currentChapterIndex + 1),
  }), [currentChapterIndex, chapters.length]);

  // Ensure chapters in range are loaded
  useEffect(() => {
    for (let i = mountedRange.start; i <= mountedRange.end; i++) {
      const chapter = chapters[i];
      if (chapter && !chapterSentences[chapter.id] && !loadingChapterIds.includes(chapter.id)) {
        loadChapterSentences(chapter.id);
      }
    }
  }, [mountedRange, chapters, chapterSentences, loadingChapterIds, loadChapterSentences]);

  // Resume and explicit jumps share one scroll operation. Wait for the entire
  // mounted window: loading a preceding neighbor changes the target's offset.
  useEffect(() => {
    const explicitJump = jumpTargetChapterIndex !== null;
    if (!explicitJump && positionRestoredRef.current) return;
    const targetIndex = jumpTargetChapterIndex ?? initialPositionRef.current.chapterIndex;
    const sentenceId = explicitJump ? jumpTargetSentenceId : initialPositionRef.current.sentenceId;
    const targetChapter = chapters[targetIndex];
    if (!targetChapter) {
      if (explicitJump) clearJumpTarget();
      return;
    }
    for (let i = Math.max(0, targetIndex - 1); i <= Math.min(chapters.length - 1, targetIndex + 1); i++) {
      if (!chapterSentences[chapters[i]!.id]) return;
    }

    const attemptScroll = () => {
      const container = scrollRef.current;
      if (!container) return;
      const sentenceEl = sentenceId
        ? Array.from(container.querySelectorAll<HTMLElement>('[data-sentence-id]'))
            .find(element => element.dataset.sentenceId === sentenceId)
        : undefined;
      // A stale/deleted sentence target should still take the user to its
      // chapter rather than leaving an unconsumable jump in state.
      const targetEl = sentenceEl
        || Array.from(container.querySelectorAll<HTMLElement>('[data-chapter-index]'))
          .find(element => element.dataset.chapterIndex === String(targetIndex));
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
        positionRestoredRef.current = true;
        const resolvedSentenceId = sentenceEl?.dataset.sentenceId || chapterSentences[targetChapter.id]?.[0]?.id;
        if (resolvedSentenceId) setCurrentSentence(resolvedSentenceId);
        if (explicitJump) clearJumpTarget();
      }
    };

    // Background tabs and embedded direct routes can suspend animation frames.
    // A cancellable task still waits for the committed DOM without requiring
    // the Reader tab to be visible before resume/bookmark jumps take effect.
    const scrollTimer = setTimeout(attemptScroll, 0);
    return () => clearTimeout(scrollTimer);
  }, [jumpTargetChapterIndex, jumpTargetSentenceId, chapterSentences, chapters, clearJumpTarget, setCurrentSentence]);

  // Debounced save of reading position
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveReadingPosition();
    }, 1000);
  }, [saveReadingPosition]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveReadingPosition();
    };
  }, [saveReadingPosition]);

  // Scroll handler — detect current chapter and sentence
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = throttle(() => {
      // Layout/placeholder changes during restoration are not user progress.
      if (!positionRestoredRef.current || useReaderStore.getState().jumpTargetChapterIndex !== null) return;
      const containerRect = container.getBoundingClientRect();
      const viewportTop = containerRect.top + 80; // offset for topbar

      // Detect current chapter by finding which chapter element is at viewport top
      const chapterEls = container.querySelectorAll('[data-chapter-index]');
      let detectedChapter = currentChapterIndex;

      for (let i = chapterEls.length - 1; i >= 0; i--) {
        const el = chapterEls[i]!;
        const rect = el.getBoundingClientRect();
        if (rect.top <= viewportTop + 50) {
          detectedChapter = parseInt(el.getAttribute('data-chapter-index') || '0');
          break;
        }
      }

      if (detectedChapter !== currentChapterIndex) {
        setCurrentChapter(detectedChapter);
      }

      // Detect current sentence (topmost visible sentence)
      const sentenceEls = container.querySelectorAll('[data-sentence-id]');
      for (const el of sentenceEls) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > viewportTop) {
          const sentenceId = el.getAttribute('data-sentence-id');
          if (sentenceId) {
            setCurrentSentence(sentenceId);
          }
          break;
        }
      }

      debouncedSave();

      // Show topbar briefly on scroll
      setTopBarVisible(true);
    }, 150);

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      handleScroll.cancel();
    };
  }, [currentChapterIndex, setCurrentChapter, setCurrentSentence, debouncedSave, setTopBarVisible]);

  // Reading size CSS variables
  const sizeStyle = useMemo(() => ({
    '--reading-cn-size': `${readingSizeValues.cnSize}px`,
    '--reading-cn-line-height': String(readingSizeValues.cnLh * lineHeightMultiplier),
    '--reading-vi-size': `${readingSizeValues.viSize}px`,
    '--reading-vi-line-height': String(readingSizeValues.viLh * lineHeightMultiplier),
  } as React.CSSProperties), [readingSizeValues, lineHeightMultiplier]);

  return (
    <div
      ref={scrollRef}
      className={styles.scrollContainer}
      style={sizeStyle}
    >
      {chapters.map((chapter, index) => {
        const isMounted = index >= mountedRange.start && index <= mountedRange.end;
        const sentences = chapterSentences[chapter.id];

        if (isMounted) {
          if (sentences) {
            return (
              <ChapterBlock
                key={chapter.id}
                chapter={chapter}
                chapterIndex={index}
                sentences={sentences}
                readingMode={readingMode}
                onHeightChange={(h) => updateChapterHeight(chapter.id, h)}
              />
            );
          }
          // Loading state for mounted but not yet loaded chapter
          return (
            <div
              key={chapter.id}
              className={styles.chapterLoading}
              data-chapter-index={index}
            >
              <div className={styles.chapterLoadingTitle}>
                <Skeleton width="60%" height="24px" />
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={styles.chapterLoadingSentence}>
                  <Skeleton width="100%" height="20px" />
                  <Skeleton width="80%" height="16px" />
                </div>
              ))}
            </div>
          );
        }

        // Placeholder for unmounted chapters (preserves scroll height)
        const height = chapterHeights[chapter.id] || (chapter.sentenceCount * 65);
        return (
          <div
            key={chapter.id}
            style={{ height: `${height}px` }}
            data-chapter-index={index}
            className={styles.chapterPlaceholder}
          />
        );
      })}

      {/* Bottom padding for comfortable reading at the end */}
      <div style={{ height: '50vh' }} />
    </div>
  );
}
