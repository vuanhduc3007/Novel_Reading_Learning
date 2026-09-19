import React, { useRef, useEffect } from 'react';
import { ChapterHeader } from './ChapterHeader';
import { SentencePair } from './SentencePair';
import type { Chapter, Sentence, ReadingMode } from '../../types';
import styles from './ChapterBlock.module.css';

interface ChapterBlockProps {
  chapter: Chapter;
  chapterIndex: number;
  sentences: Sentence[];
  readingMode: ReadingMode;
  onHeightChange: (height: number) => void;
}

export function ChapterBlock({ chapter, chapterIndex, sentences, readingMode, onHeightChange }: ChapterBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number | null>(null);
  const onHeightChangeRef = useRef(onHeightChange);

  // Keep the ref updated so the observer always calls the latest callback
  // without needing to be recreated.
  useEffect(() => {
    onHeightChangeRef.current = onHeightChange;
  }, [onHeightChange]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reportHeight = (h: number) => {
      // Discard sub-pixel differences or exact matches to prevent infinite loops
      const roundedHeight = Math.round(h);
      if (lastHeightRef.current === roundedHeight) return;
      lastHeightRef.current = roundedHeight;
      onHeightChangeRef.current(roundedHeight);
    };

    // Measure initial height
    reportHeight(el.getBoundingClientRect().height);

    // Watch for resize
    const observer = new ResizeObserver(() => {
      // Placeholders replace the entire border box, not just its content.
      reportHeight(el.getBoundingClientRect().height);
    });
    observer.observe(el, { box: 'border-box' });

    return () => observer.disconnect();
  }, [sentences.length]); // Intentionally omitting onHeightChange to prevent observer recreation

  return (
    <div
      ref={ref}
      className={styles.chapter}
      data-chapter-index={chapterIndex}
      data-chapter-id={chapter.id}
    >
      <ChapterHeader
        title={chapter.title}
        index={chapterIndex}
        sentenceCount={sentences.length}
      />
      <div className={styles.sentences}>
        {sentences.map((sentence) => (
          <SentencePair
            key={sentence.id}
            sentence={sentence}
            readingMode={readingMode}
          />
        ))}
      </div>
    </div>
  );
}
