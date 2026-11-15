import React from 'react';
import { BookOpen } from 'lucide-react';
import { EmptyState } from '../../components';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSyncStore } from '../../stores/syncStore';
import styles from './EmptyLibrary.module.css';

export function EmptyLibrary() {
  const openImportModal = useLibraryStore(s => s.openImportModal);
  const { user, status, cloudBooks } = useSyncStore();
  // Signed in: say what the account has, so an empty library is not a mystery.
  const description = !user
    ? 'Nhập sách tiếng Trung để bắt đầu đọc và học từ vựng'
    : status === 'syncing' || cloudBooks === null
      ? `Đang kiểm tra sách trên tài khoản ${user.email ?? ''}…`
      : cloudBooks.length === 0
        ? `Tài khoản ${user.email ?? ''} chưa có sách nào. Nếu sách đang ở máy khác: mở trang chi tiết sách ở máy đó và chọn lại file gốc để đưa lên tài khoản. Hoặc nhập sách ngay tại đây.`
        : `Đang tải sách từ tài khoản…`;
  
  return (
    <div className={styles.container}>
      <EmptyState
        icon={<BookOpen size={64} />}
        heading="Chưa có cuốn sách nào"
        description={description}
        action={{ label: 'Nhập cuốn sách đầu tiên', onClick: () => openImportModal('new') }}
      />
    </div>
  );
}
