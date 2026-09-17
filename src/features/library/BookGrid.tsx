import React from 'react';
import { BookCard } from './BookCard';
import type { Book } from '../../types';
import styles from './BookGrid.module.css';

export function BookGrid({ books, onReplace }: { books: Book[]; onReplace: (bookId: string) => void }) {
  return (
    <div className={styles.grid}>
      {books.map(book => (
        <BookCard key={book.id} book={book} onReplace={onReplace} />
      ))}
    </div>
  );
}
