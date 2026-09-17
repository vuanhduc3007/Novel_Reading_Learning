import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ProgressBar } from '../../components';
import type { Book } from '../../types';
import styles from './BookRow.module.css';

export function BookRow({ books }: { books: Book[] }) {
  const navigate = useNavigate();

  const activeBooks = books
    .filter(b => b.readingProgress && b.readingProgress > 0)
    .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
    .slice(0, 4);

  if (activeBooks.length === 0) return null;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Tiếp tục đọc</h2>
      <div className={styles.row}>
        {activeBooks.map(book => (
          <div key={book.id} className={styles.card} onClick={() => navigate(`/reader/${book.id}`)}>
            {book.coverUrl ? (
              <img src={book.coverUrl} alt={book.title} className={styles.cardCover} />
            ) : (
              <div className={styles.cardCover} style={{ backgroundColor: 'var(--color-surface-sunken)' }} />
            )}
            <div className={styles.cardOverlay}>
              <div className={styles.cardTitle}>{book.title}</div>
              <ProgressBar progress={book.readingProgress || 0} className={styles.cardProgress} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
