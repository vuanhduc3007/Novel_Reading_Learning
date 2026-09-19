import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, BookOpen, HardDrive, Bookmark, Languages, Trash2, RefreshCw } from 'lucide-react';
import { db } from '../../db/database';
import { Button, ProgressBar, Badge, ConfirmDialog, Skeleton } from '../../components';
import { useToast } from '../../components/Toast/ToastContext';
import { useLibraryStore } from '../../stores/libraryStore';
import { deleteBook } from './importEngine';
import { ImportModal } from './ImportModal';
import type { Book } from '../../types';
import styles from './BookDetailPage.module.css';

function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return 'Không rõ';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatRelativeTime(date?: number | null): string {
  if (!date) return 'chưa mở';
  
  const now = new Date();
  const d = new Date(date);
  
  const isToday = d.getDate() === now.getDate() && 
                  d.getMonth() === now.getMonth() && 
                  d.getFullYear() === now.getFullYear();
                  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() && 
                      d.getMonth() === yesterday.getMonth() && 
                      d.getFullYear() === yesterday.getFullYear();

  const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  
  if (isToday) return `hôm nay lúc ${timeStr}`;
  if (isYesterday) return `hôm qua lúc ${timeStr}`;
  
  const diffTime = Math.abs(now.getTime() - d.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return `${diffDays} ngày trước`;
}

export const BookDetailPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { openImportModal } = useLibraryStore();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const book = useLiveQuery(
    async () => bookId ? (await db.books.get(bookId)) ?? null : null,
    [bookId]
  );
  
  const chaptersCount = useLiveQuery(
    () => bookId ? db.chapters.where('bookId').equals(bookId).count() : 0,
    [bookId]
  );

  const totalSentences = useLiveQuery(
    () => bookId ? db.sentences.where('bookId').equals(bookId).count() : 0,
    [bookId]
  ) || 0;

  const translatedSentences = useLiveQuery(
    () => bookId ? db.sentences.where('bookId').equals(bookId).and(s => s.translationStatus === 'ready').count() : 0,
    [bookId]
  ) || 0;

  const bookmarkCount = useLiveQuery(
    () => bookId ? db.bookmarks.where('bookId').equals(bookId).count() : 0,
    [bookId]
  ) || 0;

  const vocabularyCount = useLiveQuery(
    () => bookId ? db.vocabularyItems.where('sourceBookId').equals(bookId).count() : 0,
    [bookId]
  ) || 0;

  const transPercent = totalSentences > 0 ? Math.round((translatedSentences / totalSentences) * 100) : 0;

  const isUnavailable = book?.importStatus === 'unavailable';

  const handleDelete = async () => {
    if (bookId) {
      try {
        await deleteBook(bookId);
        showToast('Đã xóa sách', 'success');
        navigate('/');
      } catch (err: any) {
        showToast(`Lỗi khi xóa: ${err.message}`, 'error');
      }
    }
    setIsDeleteModalOpen(false);
  };

  const handleReplace = () => {
    if (bookId) {
      openImportModal('replace', bookId);
    }
  };

  useEffect(() => {
    if (book === null) {
      navigate('/', { replace: true });
    }
  }, [book, navigate]);

  if (book === undefined) {
    return (
      <div className={styles.page}>
        <Skeleton width="100px" height="20px" className={styles.backLink} />
        <div className={styles.content}>
          <Skeleton className={styles.cover} />
          <div>
            <Skeleton width="80%" height="32px" />
            <Skeleton width="40%" height="24px" className={styles.author} />
            <Skeleton width="100%" height="150px" />
          </div>
        </div>
      </div>
    );
  }

  if (book === null) {
    return <div className={styles.page}>Không tìm thấy sách. Đang quay lại thư viện…</div>;
  }

  const safeReadingProgress = Number.isFinite(book.readingProgress)
    ? Math.min(Math.max(book.readingProgress, 0), 100)
    : 0;
  const readPercent = safeReadingProgress.toFixed(1);
  const currentChap = Math.min(book.lastReadChapterIndex + 1, chaptersCount || 1);

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.backLink}>
        <ArrowLeft size={16} /> Library
      </Link>
      
      <div className={styles.content}>
        <div className={styles.coverWrapper}>
          {book.coverUrl ? (
            <img src={book.coverUrl} alt={book.title} className={styles.cover} />
          ) : (
            <div className={styles.coverPlaceholder}>
              <BookOpen size={48} color="var(--color-accent)" />
            </div>
          )}
        </div>
        
        <div className={styles.info}>
          <h1 className={styles.title}>{book.title}</h1>
          <div className={styles.author}>{book.author || 'Không rõ tác giả'}</div>
          
          <div className={styles.metaRow}>
            <Badge>{book.sourceFormat.toUpperCase()}</Badge>
            <div className={styles.metaItem}>
              <HardDrive size={14} />
              {formatFileSize(book.fileSizeBytes)}
            </div>
            {isUnavailable && (
              <Badge variant="error">Không tìm thấy file</Badge>
            )}
          </div>
          
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Tiến trình đọc</div>
            <ProgressBar value={safeReadingProgress} variant="labeled" />
            <div className={styles.progressInfo}>
              Chương {currentChap}/{chaptersCount || '?'} · {readPercent}% · Mở lần cuối: {formatRelativeTime(book.lastOpenedAt)}
            </div>
          </div>
          
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Tiến trình dịch</div>
            <ProgressBar value={transPercent} variant="labeled" />
            <div className={styles.progressInfo}>{transPercent}% · {translatedSentences} / {totalSentences} câu</div>
          </div>
          
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <div className={styles.statValue}>{bookmarkCount}</div>
              <div className={styles.statLabel}><Bookmark size={14} style={{display:'inline', verticalAlign:'middle', marginRight:'4px'}} />Bookmark</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statValue}>{vocabularyCount}</div>
              <div className={styles.statLabel}><Languages size={14} style={{display:'inline', verticalAlign:'middle', marginRight:'4px'}} />Từ vựng</div>
            </div>
          </div>
          
          <div className={styles.divider}></div>
          
          <div className={styles.actions}>
            {!isUnavailable && (
              <Button 
                variant="primary"
                className={styles.primaryAction} 
                onClick={() => navigate(`/reader/${book.id}`)}
              >
                Tiếp tục đọc
              </Button>
            )}
            <Button variant="secondary" onClick={handleReplace}>
              <RefreshCw size={16} /> Thay thế / Nhập lại
            </Button>
            <Button variant="ghost" className={styles.destructiveAction} onClick={() => setIsDeleteModalOpen(true)}>
              <Trash2 size={16} /> Xóa sách
            </Button>
          </div>
        </div>
      </div>
      
      <ConfirmDialog
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Xóa sách"
        message={`Bạn có chắc chắn muốn xóa "${book.title}" khỏi thư viện?`}
        confirmLabel="Xóa"
        cancelLabel="Hủy"
        variant="destructive"
      />
      
      <ImportModal />
    </div>
  );
};
