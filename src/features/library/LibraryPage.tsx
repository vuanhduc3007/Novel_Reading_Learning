import React, { useState, useCallback, useMemo, DragEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { useLibraryStore } from '../../stores/libraryStore';
import { BookGrid } from './BookGrid';
import { BookRow } from './BookRow';
import { EmptyLibrary } from './EmptyLibrary';
import { SearchBar, Dropdown, Skeleton, Button } from '../../components';
import type { Book } from '../../types';
import styles from './LibraryPage.module.css';

import { ImportModal } from './ImportModal';

const sortOptions = [
  { value: 'recent', label: 'Gần đây nhất' },
  { value: 'newest', label: 'Mới thêm gần đây' },
  { value: 'last_opened', label: 'Mở gần đây nhất' },
];

export function LibraryPage() {
  const books = useLiveQuery(() => db.books.toArray());
  const { searchQuery, setSearchQuery, sortOption, setSortOption, openImportModal } = useLibraryStore();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      openImportModal('new');
    }
  }, [openImportModal]);

  const handleReplace = useCallback((bookId: string) => {
    openImportModal('replace', bookId);
  }, [openImportModal]);

  const filteredAndSortedBooks = useMemo(() => {
    if (!books) return [];
    
    let filtered = books;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = books.filter(b => 
        b.title.toLowerCase().includes(q) || 
        (b.author && b.author.toLowerCase().includes(q))
      );
    }
    
    return filtered.sort((a, b) => {
      if (sortOption === 'recent') {
        const timeA = a.lastOpenedAt || a.createdAt || 0;
        const timeB = b.lastOpenedAt || b.createdAt || 0;
        return timeB - timeA;
      }
      if (sortOption === 'newest') {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      if (sortOption === 'last_opened') {
        return (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0);
      }
      return 0;
    });
  }, [books, searchQuery, sortOption]);

  if (books === undefined) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Thư viện</h1>
        </div>
        <div className={styles.skeletonGrid}>
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="240px" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div 
      className={styles.page}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragOverlayText}>Thả file vào đây để nhập sách</div>
        </div>
      )}

      {books.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <>
          <div className={styles.header}>
            <h1>Thư viện</h1>
            <SearchBar 
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Tìm kiếm sách..."
              style={{ width: '320px' }}
            />
            <Dropdown
              value={sortOption}
              options={sortOptions}
              onChange={(val) => setSortOption(val as any)}
            />
            <Button className={styles.importBtn} onClick={() => openImportModal('new')}>
              Thêm sách
            </Button>
          </div>

          <BookRow books={books} />
          
          <h2 className={styles.sectionTitle}>Tất cả sách</h2>
          <BookGrid books={filteredAndSortedBooks} onReplace={handleReplace} />
        </>
      )}

      <ImportModal />
    </div>
  );
}
