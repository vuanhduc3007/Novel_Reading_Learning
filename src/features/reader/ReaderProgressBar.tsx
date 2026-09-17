import React from 'react';
import { useReaderStore } from '../../stores/readerStore';
import styles from './ReaderProgressBar.module.css';

export function ReaderProgressBar() {
  const readingProgress = useReaderStore(s => s.readingProgress);

  return (
    <div className={styles.container}>
      <div
        className={styles.fill}
        style={{ width: `${readingProgress}%` }}
      />
    </div>
  );
}
