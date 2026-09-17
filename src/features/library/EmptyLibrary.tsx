import React from 'react';
import { BookOpen } from 'lucide-react';
import { EmptyState } from '../../components';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './EmptyLibrary.module.css';

export function EmptyLibrary() {
  const openImportModal = useLibraryStore(s => s.openImportModal);
  
  return (
    <div className={styles.container}>
      <EmptyState
        icon={<BookOpen size={64} />}
        heading="Chưa có cuốn sách nào"
        description="Nhập sách tiếng Trung để bắt đầu đọc và học từ vựng"
        action={{ label: 'Nhập cuốn sách đầu tiên', onClick: () => openImportModal('new') }}
      />
    </div>
  );
}
