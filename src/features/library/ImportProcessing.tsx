import React from 'react';
import { Check, Loader2, Circle } from 'lucide-react';
import { ProgressBar } from '../../components';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './ImportProcessing.module.css';

const STEPS = [
  { key: 'uploading', label: 'Đang tải lên' },
  { key: 'parsing', label: 'Phân tích cấu trúc' },
  { key: 'extracting', label: 'Tách chương' },
  { key: 'processing', label: 'Xử lý văn bản' },
  { key: 'ready', label: 'Sẵn sàng' },
] as const;

export const ImportProcessing: React.FC = () => {
  const { importProgress } = useLibraryStore();
  if (!importProgress) {
    return <div className={styles.container}>Đang khởi tạo nhập sách…</div>;
  }
  
  const currentStepIndex = STEPS.findIndex(s => s.key === importProgress.step);

  return (
    <div className={styles.container}>
      <ProgressBar 
        value={importProgress.percent} 
        variant="labeled" 
        label="Tiến trình"
      />
      
      <div className={styles.detail}>
        {importProgress.detail || 'Đang xử lý...'}
      </div>
      
      <div className={styles.steps}>
        {STEPS.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isPending = index > currentStepIndex;
          
          return (
            <div key={step.key} className={styles.step}>
              <div className={`${styles.stepIcon} ${
                isCompleted ? styles.stepCompleted : 
                isCurrent ? styles.stepCurrent : 
                styles.stepPending
              }`}>
                {isCompleted ? (
                  <Check size={16} />
                ) : isCurrent ? (
                  <Loader2 size={16} className={styles.spinAnimation} />
                ) : (
                  <Circle size={16} />
                )}
              </div>
              <div className={`${styles.stepLabel} ${
                isCompleted ? styles.stepLabelDone :
                isCurrent ? styles.stepLabelActive :
                styles.stepLabelPending
              }`}>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
