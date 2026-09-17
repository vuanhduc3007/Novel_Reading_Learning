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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Measure initial height
    onHeightChange(el.offsetHeight);

    // Watch for resize
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        onHeightChange(entry.contentRect.height + /* padding */ 0);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sentences.length, onHeightChange]);

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
