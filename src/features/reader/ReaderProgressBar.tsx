import React from 'react';
import { useReaderStore } from '../../stores/readerStore';
import styles from './ReaderProgressBar.module.css';

export function ReaderProgressBar() {
  const readingProgress = useReaderStore(s => s.readingProgress);
  const safeProgress = Number.isFinite(readingProgress) ? Math.min(Math.max(readingProgress, 0), 100) : 0;

  return (
    <div className={styles.container}>
      <div
        className={styles.fill}
        style={{ width: `${safeProgress}%` }}
      />
    </div>
  );
}
