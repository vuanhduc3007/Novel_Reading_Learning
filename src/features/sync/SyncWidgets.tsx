import React, { useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Cloud, CloudOff, RefreshCw, Upload } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../../components';
import { useToast } from '../../components/Toast/ToastContext';
import { db } from '../../db/database';
import { useSyncStore } from '../../stores/syncStore';
import { keepBookFile, markDirty } from './localChanges';
import styles from './Sync.module.css';

/** Small account/sync indicator for the global navigation. */
export function SyncNavStatus() {
  const { configured, user, status } = useSyncStore();
  if (!configured) return null;
  const title = !user
    ? 'Chưa đăng nhập — bấm để đăng nhập và đồng bộ giữa các máy'
    : status === 'syncing' ? 'Đang đồng bộ…' : status === 'error' ? 'Lỗi đồng bộ — bấm để xem' : `Đã đồng bộ (${user.email})`;
  const className = `${styles.navStatus} ${status === 'syncing' ? styles.navSyncing : ''} ${status === 'error' ? styles.navError : ''}`;
  return (
    <NavLink to="/settings" className={className} title={title} aria-label={title}>
      {!user ? <CloudOff size={18} /> : status === 'syncing' ? <RefreshCw size={18} className={styles.spin} /> : <Cloud size={18} />}
    </NavLink>
  );
}

/** Library banner while books from the account are being rebuilt here. */
export function SyncLibraryBanner() {
  const progress = useSyncStore(s => s.progress);
  if (!progress || progress.phase !== 'download') return null;
  return (
    <div className={styles.banner} role="status">
      <span>{progress.detail}</span>
      {progress.percent !== undefined && (
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${progress.percent}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * Books imported before accounts existed have no original file kept. Ask for
 * it once so the book can be uploaded and rebuilt on other devices.
 */
export function BookCloudStatus({ bookId, fileSizeBytes }: { bookId: string; fileSizeBytes: number }) {
  const { configured, user } = useSyncStore();
  const { showToast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const state = useLiveQuery(async () => {
    const book = await db.books.get(bookId);
    const source = await db.bookFiles.get([bookId, 'source']);
    return { uploaded: Boolean(book?.cloudSourcePath), hasFile: Boolean(source) };
  }, [bookId]);

  if (!configured || !user || !state) return null;
  if (state.uploaded) return <p className={styles.muted}><Cloud size={14} /> Sách đã có trên tài khoản — đăng nhập ở máy khác là đọc được.</p>;
  if (state.hasFile) return <p className={styles.muted}><RefreshCw size={14} /> Đang chờ tải sách lên tài khoản…</p>;

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (fileSizeBytes > 0 && file.size !== fileSizeBytes) {
      showToast('File này khác file đã dùng để nhập sách (kích thước không khớp). Hãy chọn đúng file gốc.', 'error');
      return;
    }
    setBusy(true);
    try {
      await keepBookFile(bookId, 'source', file);
      markDirty('book', bookId);
      void useSyncStore.getState().syncNow();
      showToast('Đang tải sách lên tài khoản', 'success');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.account}>
      <p className={styles.warning}>
        Sách này được nhập trước khi có tài khoản nên chưa có file gốc để đưa lên. Chọn lại đúng file đã dùng để nhập
        (tiến độ đọc và bản dịch đã ghép vẫn giữ nguyên).
      </p>
      <div className={styles.actions}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={14} /> Chọn file gốc để đồng bộ
        </Button>
      </div>
      <input ref={input} type="file" accept=".epub,.txt,.md,.html,.htm" hidden onChange={onFile} />
    </div>
  );
}
