import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, MoreVertical, Trash2, RefreshCw, BookMarked, ExternalLink, AlertTriangle } from 'lucide-react';
import { ProgressBar, Badge, ConfirmDialog } from '../../components';
import { useToast } from '../../components/Toast/ToastContext';
import { deleteBook } from './importEngine';
import type { Book } from '../../types';
import styles from './BookCard.module.css';

function getRelativeTime(timestamp: number) {
  const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
  const diff = (timestamp - Date.now()) / 1000;
  if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), 'second');
  if (Math.abs(diff) < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (Math.abs(diff) < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (Math.abs(diff) < 604800) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / 604800), 'week');
}

export function BookCard({ book, onReplace }: { book: Book; onReplace?: (bookId: string) => void }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteBook(book.id);
      showToast(`Đã xóa "${book.title}"`, 'success');
    } catch (e) {
      showToast('Lỗi khi xóa sách', 'error');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (onReplace) onReplace(book.id);
  };

  return (
    <>
      <div
        className={`${styles.card} ${isDragOver ? styles.dragOver : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className={styles.coverWrapper} onClick={() => navigate(`/reader/${book.id}`)}>
          {book.coverUrl ? (
            <img src={book.coverUrl} alt={book.title} className={styles.cover} />
          ) : (
            <div className={styles.coverPlaceholder}>
              <BookOpen size={48} className={styles.accentIcon} />
            </div>
          )}
          
          {book.importStatus === 'failed' && (
            <div className={styles.statusBadge}>
              <Badge variant="error">Nhập thất bại</Badge>
            </div>
          )}
          
          <button
            className={styles.kebab}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          >
            <MoreVertical size={20} />
          </button>
          
          {menuOpen && (
            <div className={styles.kebabMenu} onClick={(e) => e.stopPropagation()}>
              <div className={styles.kebabItem} onClick={() => navigate(`/reader/${book.id}`)}>
                <BookMarked size={16} /> Tiếp tục đọc
              </div>
              <div className={styles.kebabItem} onClick={() => { setMenuOpen(false); onReplace?.(book.id); }}>
                <RefreshCw size={16} /> Thay thế/Nhập lại
              </div>
              <div className={`${styles.kebabItem} ${styles.destructive}`} onClick={() => { setIsDeleting(true); setMenuOpen(false); }}>
                <Trash2 size={16} /> Xóa sách
              </div>
            </div>
          )}
        </div>
        
        <div className={styles.info} onClick={() => navigate(`/reader/${book.id}`)}>
          <div className={styles.title} title={book.title}>{book.title}</div>
          <div className={styles.author}>{book.author || 'Không rõ tác giả'}</div>
          {book.readingProgress !== undefined && book.readingProgress > 0 && (
            <ProgressBar value={book.readingProgress} className={styles.progress} />
          )}
          <div className={styles.meta}>
            {book.lastOpenedAt ? `Mở ${getRelativeTime(book.lastOpenedAt)}` : 'Chưa đọc'}
          </div>
        </div>
      </div>
      
      <ConfirmDialog
        isOpen={isDeleting}
        title="Xóa sách"
        message={`Xóa '${book.title}'? Bookmark và tiến trình đọc của sách này sẽ bị xóa. Từ vựng đã lưu từ sách này vẫn được giữ lại trong Vocabulary.`}
        confirmLabel="Xóa"
        cancelLabel="Hủy"
        onConfirm={handleDelete}
        onClose={() => setIsDeleting(false)}
      />
    </>
  );
}
