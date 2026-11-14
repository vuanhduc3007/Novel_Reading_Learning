import React, { useState } from 'react';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../../components';
import { useToast } from '../../components/Toast/ToastContext';
import { db } from '../../db/database';
import { useSyncStore } from '../../stores/syncStore';
import styles from './Sync.module.css';

function formatTime(timestamp: number | null): string {
  if (!timestamp) return 'chưa đồng bộ';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'vừa xong';
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút trước`;
  return new Date(timestamp).toLocaleString('vi-VN');
}

/** Sign-in form or account status, shown on the Settings page. */
export function AccountPanel() {
  const { configured, authReady, user, status, progress, lastSyncedAt, error, missingFiles, signIn, signUp, signOut, syncNow } = useSyncStore();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useLiveQuery(() => db.syncDirty.count(), []) ?? 0;

  if (!configured) {
    return (
      <p className={styles.muted}>
        Bản app này chưa được cấu hình tài khoản (thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
        Sách và tiến độ chỉ lưu trên máy này.
      </p>
    );
  }
  if (!authReady) return <p className={styles.muted}>Đang kiểm tra đăng nhập…</p>;

  if (user) {
    return (
      <div className={styles.account}>
        <div className={styles.accountRow}>
          <Cloud size={18} />
          <span>Đã đăng nhập: <strong>{user.email}</strong></span>
        </div>
        <p className={styles.muted}>
          {status === 'syncing'
            ? progress?.detail ?? 'Đang đồng bộ…'
            : status === 'error'
              ? `Lỗi đồng bộ: ${error}`
              : `Đồng bộ lần cuối: ${formatTime(lastSyncedAt)}${pending > 0 ? ` · ${pending} thay đổi chờ gửi` : ''}`}
        </p>
        {missingFiles.length > 0 && (
          <p className={styles.warning}>
            {missingFiles.length} sách được nhập trước khi có tính năng tài khoản nên chưa có file gốc để đưa lên.
            Mở trang chi tiết của sách và chọn lại file gốc để đồng bộ sang máy khác.
          </p>
        )}
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={() => void syncNow()} disabled={status === 'syncing'}>
            <RefreshCw size={14} /> Đồng bộ ngay
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            <LogOut size={14} /> Đăng xuất
          </Button>
        </div>
        <p className={styles.muted}>
          Đồng bộ: sách (file gốc và bản dịch), vị trí đang đọc, từ đang học/đã thuộc, sổ từ, dấu trang, cài đặt.
          Trên máy khác chỉ cần đăng nhập, sách sẽ tự tải về.
        </p>
      </div>
    );
  }

  const submit = async (mode: 'in' | 'up') => {
    if (!email.trim() || password.length < 6) {
      showToast('Nhập email và mật khẩu (ít nhất 6 ký tự)', 'error');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'in') {
        await signIn(email.trim(), password);
        showToast('Đã đăng nhập — đang đồng bộ', 'success');
      } else if (await signUp(email.trim(), password) === 'confirm_email') {
        showToast('Đã tạo tài khoản. Mở thư xác nhận trong hộp thư rồi đăng nhập.', 'info');
      } else {
        showToast('Đã tạo tài khoản và đăng nhập', 'success');
      }
      setPassword('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.account} onSubmit={event => { event.preventDefault(); void submit('in'); }}>
      <p className={styles.muted}>
        Đăng nhập để dùng sách và tiến độ đọc trên nhiều máy. Dữ liệu trên máy này sẽ được đưa lên tài khoản.
      </p>
      <label className={styles.field}>
        <span>Email</span>
        <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
      </label>
      <label className={styles.field}>
        <span>Mật khẩu</span>
        <input type="password" autoComplete="current-password" minLength={6} value={password} onChange={event => setPassword(event.target.value)} required />
      </label>
      <div className={styles.actions}>
        <Button size="sm" type="submit" disabled={busy}>Đăng nhập</Button>
        <Button size="sm" type="button" variant="secondary" disabled={busy} onClick={() => void submit('up')}>Tạo tài khoản</Button>
      </div>
    </form>
  );
}
