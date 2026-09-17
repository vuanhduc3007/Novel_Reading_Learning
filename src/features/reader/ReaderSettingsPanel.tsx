import React from 'react';
import { X } from 'lucide-react';
import { useReaderStore } from '../../stores/readerStore';
import type { ReadingMode, ReadingSize } from '../../types';
import styles from './ReaderSettingsPanel.module.css';

const SIZES: ReadingSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

export const ReaderSettingsPanel: React.FC = () => {
  const { isSettingsOpen, toggleSettings, readingMode, setReadingMode, readingSize, setReadingSize, lineHeightMultiplier, setLineHeightMultiplier } = useReaderStore();

  if (!isSettingsOpen) return null;

  return (
    <>
      <div className={styles.backdrop} onClick={toggleSettings} />
      <div className={`${styles.panel} ${isSettingsOpen ? styles.open : ''}`}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Cài đặt đọc</span>
          <button className={styles.closeBtn} onClick={toggleSettings} aria-label="Close settings">
            <X size={20} />
          </button>
        </div>
        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Chế độ hiển thị</div>
            <div className={styles.segmented}>
              <button
                className={`${styles.segmentedBtn} ${readingMode === 'bilingual' ? styles.active : ''}`}
                onClick={() => setReadingMode('bilingual')}
              >
                Song ngữ
              </button>
              <button
                className={`${styles.segmentedBtn} ${readingMode === 'chinese_only' ? styles.active : ''}`}
                onClick={() => setReadingMode('chinese_only')}
              >
                Chỉ Hán
              </button>
              <button
                className={`${styles.segmentedBtn} ${readingMode === 'on_demand' ? styles.active : ''}`}
                onClick={() => setReadingMode('on_demand')}
              >
                Khi cần
              </button>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Cỡ chữ</div>
            <div className={styles.sizeSlider}>
              <span className={styles.sizeLabel}>A-</span>
              <div className={styles.sizeTrack}>
                {SIZES.map((size, index) => (
                  <div
                    key={size}
                    className={`${styles.sizeDot} ${readingSize === size ? styles.current : ''} ${SIZES.indexOf(readingSize) >= index ? styles.active : ''}`}
                    onClick={() => setReadingSize(size)}
                  >
                    <div className={styles.sizeDotMarker} />
                  </div>
                ))}
              </div>
              <span className={styles.sizeLabel}>A+</span>
            </div>
            <div className={styles.previewText} style={{ fontSize: readingSize === 'S' ? '14px' : readingSize === 'M' ? '16px' : readingSize === 'L' ? '18px' : readingSize === 'XL' ? '20px' : '22px' }}>
              这是预览文字<br/>
              <span style={{ fontSize: '0.8em', color: 'var(--color-text-secondary)' }}>Đây là văn bản xem trước</span>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Khoảng cách dòng</div>
            <div className={styles.segmented}>
              <button className={`${styles.segmentedBtn} ${lineHeightMultiplier === 1.0 ? styles.active : ''}`} onClick={() => setLineHeightMultiplier(1.0)}>Nhỏ</button>
              <button className={`${styles.segmentedBtn} ${lineHeightMultiplier === 1.2 ? styles.active : ''}`} onClick={() => setLineHeightMultiplier(1.2)}>Vừa</button>
              <button className={`${styles.segmentedBtn} ${lineHeightMultiplier === 1.5 ? styles.active : ''}`} onClick={() => setLineHeightMultiplier(1.5)}>Lớn</button>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Chiều rộng nội dung <span className={styles.comingSoon}>(Sắp ra mắt)</span></div>
            <div className={`${styles.segmented} ${styles.disabled}`}>
              <button className={styles.segmentedBtn}>60%</button>
              <button className={styles.segmentedBtn}>80%</button>
              <button className={styles.segmentedBtn}>100%</button>
            </div>
          </div>
          
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Font chữ <span className={styles.comingSoon}>(Sắp ra mắt)</span></div>
            <div className={`${styles.segmented} ${styles.disabled}`}>
              <button className={styles.segmentedBtn}>Serif</button>
              <button className={styles.segmentedBtn}>Sans</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
