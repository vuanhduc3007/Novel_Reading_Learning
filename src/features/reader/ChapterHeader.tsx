import React from 'react';
import styles from './ChapterHeader.module.css';

interface ChapterHeaderProps {
  title: string;
  index: number;
  sentenceCount: number;
}

export function ChapterHeader({ title, index, sentenceCount }: ChapterHeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.index}>Chapter {index + 1}</span>
      <h2 className={styles.title}>{title}</h2>
      <span className={styles.meta}>{sentenceCount} câu</span>
    </div>
  );
}
