import React, { useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Button } from '../../components';
import { useToast } from '../../components/Toast/ToastContext';
import { useReaderStore } from '../../stores/readerStore';
import { useImmersionStore } from '../../stores/immersionStore';
import { importReferenceTranslation, type ReferenceImportProgress } from '../reference/referenceImport';
import styles from './Immersion.module.css';

function dismissKey(bookId: string) {
  return `reference-banner-dismissed:${bookId}`;
}

function isDismissed(bookId: string): boolean {
  try { return localStorage.getItem(dismissKey(bookId)) === '1'; } catch { return false; }
}

/**
 * Invites the reader to attach a human Vietnamese translation of the book.
 * Machine translation of web novels is hard to enjoy; a human translation
 * aligned sentence by sentence is what makes Vietnamese-first reading work.
 */
export function ReferenceBanner() {
  const bookId = useReaderStore(s => s.bookId);
  const referenceTitle = useReaderStore(s => s.referenceTitle);
  const readingMode = useReaderStore(s => s.readingMode);
  const { showToast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ReferenceImportProgress | null>(null);
  const [dismissed, setDismissed] = useState(() => (bookId ? isDismissed(bookId) : false));

  if (!bookId || readingMode === 'chinese_only') return null;
  if (!progress && (referenceTitle || dismissed)) return null;

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProgress({ percent: 0, detail: 'Đang đọc file…' });
    try {
      const summary = await importReferenceTranslation(bookId, file, setProgress);
      await useReaderStore.getState().reloadBookData();
      void useImmersionStore.getState().rebuildStats();
      showToast(
        `Đã ghép bản dịch "${summary.title}": ${summary.matchedChapters}/${summary.totalChapters} chương, ` +
        `${summary.matchedSentences.toLocaleString('vi-VN')}/${summary.totalSentences.toLocaleString('vi-VN')} câu.`,
        'success',
      );
    } catch (error) {
      showToast(`Không ghép được bản dịch: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setProgress(null);
    }
  };

  const dismiss = () => {
    try { localStorage.setItem(dismissKey(bookId), '1'); } catch { /* optional */ }
    setDismissed(true);
  };

  return (
    <div className={styles.banner} role="region" aria-label="Bản dịch tiếng Việt">
      {progress ? (
        <>
          <p className={styles.bannerText}>Đang ghép bản dịch với bản gốc — {progress.detail}</p>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
          </div>
        </>
      ) : (
        <>
          <p className={styles.bannerText}>
            <strong>Đang dùng máy dịch.</strong> Nếu bạn có bản dịch tiếng Việt của truyện này (EPUB hoặc TXT),
            chọn file để app ghép từng câu với bản gốc — đọc tự nhiên hơn nhiều, tên riêng và thuật ngữ đúng.
            File chỉ lưu trong trình duyệt của bạn.
          </p>
          <div className={styles.bannerActions}>
            <Button size="sm" onClick={() => input.current?.click()}>
              <FileText size={14} /> Chọn file bản dịch
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Ẩn">
              <X size={14} />
            </Button>
          </div>
        </>
      )}
      <input ref={input} type="file" accept=".epub,.txt,.md" hidden onChange={onFile} />
    </div>
  );
}
