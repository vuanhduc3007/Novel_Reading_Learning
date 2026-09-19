import React, { useState, useRef, useCallback, DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { Modal, Button } from '../../components';
import { useToast } from '../../components/Toast/ToastContext';
import { useLibraryStore } from '../../stores/libraryStore';
import { importBook, replaceBook } from './importEngine';
import { ImportProcessing } from './ImportProcessing';
import styles from './ImportModal.module.css';

const ACCEPTED_EXTENSIONS = ['.epub', '.txt', '.html', '.htm', '.md'];

function isValidFile(file: File): boolean {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return ACCEPTED_EXTENSIONS.includes(ext);
}

export const ImportModal: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { 
    isImportModalOpen, 
    importMode, 
    replaceBookId,
    isImporting,
    importedBookId,
    importError,
    closeImportModal,
    setIsImporting,
    setImportProgress,
    setImportError,
    setImportedBookId,
    resetImportState
  } = useLibraryStore();

  const [isDragOver, setIsDragOver] = useState(false);
  const [dragInvalid, setDragInvalid] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (isImporting) return;
    closeImportModal();
  };

  const processFile = async (file: File) => {
    if (useLibraryStore.getState().isImporting) return;
    if (!isValidFile(file)) {
      setImportError('Định dạng file không hỗ trợ. Vui lòng chọn EPUB, TXT, HTML hoặc MD.');
      return;
    }

    // `ImportProcessing` renders immediately after this update. Seed a
    // progress object first so it never dereferences null during that render.
    setImportProgress({ step: 'uploading', percent: 0, detail: 'Reading file...' });
    setIsImporting(true);
    setImportError(null);

    try {
      let bookId: string;
      if (importMode === 'replace' && replaceBookId) {
        bookId = await replaceBook(replaceBookId, file, setImportProgress);
      } else {
        bookId = await importBook(file, setImportProgress);
      }
      setImportedBookId(bookId);
    } catch (err: any) {
      setImportError(err.message || 'Đã xảy ra lỗi khi nhập sách.');
      setIsImporting(false);
    }
  };

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
    
    // Check if the dragged item is valid (rough check during drag)
    if (e.dataTransfer.items.length > 0) {
      const item = e.dataTransfer.items[0];
      if (item?.kind === 'file') {
        // Can't reliably check extension here in all browsers, so just accept it visually until drop
        setDragInvalid(false);
      }
    }
  }, [isDragOver]);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    setDragInvalid(false);
  }, []);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    setDragInvalid(false);
    
    if (e.dataTransfer.files?.[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [importMode, replaceBookId]);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      processFile(e.target.files[0]);
    }
    // Reset input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRetry = () => {
    resetImportState();
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const title = importMode === 'replace' ? 'Thay thế sách' : 'Nhập sách mới';

  let content;

  if (isImporting && !importedBookId && !importError) {
    content = <ImportProcessing />;
  } else if (importedBookId) {
    content = (
      <div className={styles.successState}>
        <CheckCircle className={styles.successIcon} size={48} />
        <h3>Sách đã sẵn sàng!</h3>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleClose}>Đóng</Button>
          <Button variant="primary" onClick={() => {
            handleClose();
            navigate(`/reader/${importedBookId}`);
          }}>Mở sách</Button>
        </div>
      </div>
    );
  } else if (importError) {
    content = (
      <div className={styles.errorState}>
        <AlertCircle className={styles.errorIcon} size={48} />
        <h3>Lỗi nhập sách</h3>
        <p className={styles.fileError}>{importError}</p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleClose}>Đóng</Button>
          <Button variant="primary" onClick={handleRetry}>Thử lại</Button>
        </div>
      </div>
    );
  } else {
    content = (
      <>
        {importMode === 'replace' && (
          <div className={styles.warningBlock}>
            Thay thế sẽ đặt lại tiến trình đọc, bookmark, và trạng thái dịch của phiên bản cũ. Từ vựng đã lưu vẫn được giữ lại.
          </div>
        )}
        <div 
          className={`${styles.dropzone} ${isDragOver ? styles.dropzoneDragOver : ''} ${dragInvalid ? styles.dropzoneInvalid : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className={styles.dropzoneIcon} size={32} />
          <div className={styles.dropzoneText}>Kéo sách vào đây</div>
          <div className={styles.dropzoneSubtext}>EPUB · TXT · HTML · MD</div>
          <Button variant="secondary" className={styles.dropzoneButton} onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}>Chọn file</Button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={onFileSelect}
            accept={ACCEPTED_EXTENSIONS.join(',')}
            style={{ display: 'none' }}
          />
        </div>
      </>
    );
  }

  return (
    <Modal isOpen={isImportModalOpen} onClose={handleClose} title={title}>
      {content}
    </Modal>
  );
};
