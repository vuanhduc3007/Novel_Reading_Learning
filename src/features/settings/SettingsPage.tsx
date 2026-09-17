import React from 'react';
import { useAppStore } from '../../stores/appStore';
import { useReaderStore } from '../../stores/readerStore';
import type { ThemeMode, ReadingSize } from '../../types';
import styles from './SettingsPage.module.css';

const SIZES: ReadingSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

export function SettingsPage() {
  const { theme, setTheme } = useAppStore();
  const { readingMode, setReadingMode, readingSize, setReadingSize, lineHeightMultiplier, setLineHeightMultiplier } = useReaderStore();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Cài đặt</h1>
      </header>
      
      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Giao diện (Theme)</h2>
          <div className={styles.segmented}>
            <button 
              className={`${styles.segmentedBtn} ${theme === 'light' ? styles.active : ''}`}
              onClick={() => setTheme('light')}
            >Sáng</button>
            <button 
              className={`${styles.segmentedBtn} ${theme === 'dark' ? styles.active : ''}`}
              onClick={() => setTheme('dark')}
            >Tối</button>
            <button 
              className={`${styles.segmentedBtn} ${theme === 'system' ? styles.active : ''}`}
              onClick={() => setTheme('system')}
            >Hệ thống</button>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Đọc sách (Reading)</h2>
          
          <div className={styles.settingGroup}>
            <div className={styles.settingLabel}>Chế độ đọc</div>
            <div className={styles.segmented}>
              <button 
                className={`${styles.segmentedBtn} ${readingMode === 'bilingual' ? styles.active : ''}`}
                onClick={() => setReadingMode('bilingual')}
              >Song ngữ</button>
              <button 
                className={`${styles.segmentedBtn} ${readingMode === 'chinese_only' ? styles.active : ''}`}
                onClick={() => setReadingMode('chinese_only')}
              >Chỉ Hán</button>
              <button 
                className={`${styles.segmentedBtn} ${readingMode === 'on_demand' ? styles.active : ''}`}
                onClick={() => setReadingMode('on_demand')}
              >Khi cần</button>
            </div>
          </div>

          <div className={styles.settingGroup}>
            <div className={styles.settingLabel}>Cỡ chữ</div>
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
          </div>

          <div className={styles.settingGroup}>
            <div className={styles.settingLabel}>Khoảng cách dòng</div>
            <div className={styles.segmented}>
              <button 
                className={`${styles.segmentedBtn} ${lineHeightMultiplier === 1.0 ? styles.active : ''}`}
                onClick={() => setLineHeightMultiplier(1.0)}
              >1.0 (Nhỏ)</button>
              <button 
                className={`${styles.segmentedBtn} ${lineHeightMultiplier === 1.2 ? styles.active : ''}`}
                onClick={() => setLineHeightMultiplier(1.2)}
              >1.2 (Vừa)</button>
              <button 
                className={`${styles.segmentedBtn} ${lineHeightMultiplier === 1.5 ? styles.active : ''}`}
                onClick={() => setLineHeightMultiplier(1.5)}
              >1.5 (Lớn)</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
