import React from 'react';
import { X } from 'lucide-react';
import { useReaderStore } from '../../stores/readerStore';
import { useImmersionStore, LEARNING_SIZES } from '../../stores/immersionStore';
import type { ChineseFont, ContentWidth, ReadingMode, ReadingSize } from '../../types';
import styles from './ReaderSettingsPanel.module.css';

const SIZES: ReadingSize[] = ['S', 'M', 'L', 'XL', 'XXL'];
export const WIDTHS: Array<[ContentWidth, string]> = [['narrow', 'Hẹp'], ['medium', 'Vừa'], ['wide', 'Rộng']];
export const FONTS: Array<[ChineseFont, string, string]> = [
  ['serif', '宋体 Có chân', 'var(--font-chinese-serif)'],
  ['sans', '黑体 Không chân', 'var(--font-chinese-sans)'],
];

export const ReaderSettingsPanel: React.FC = () => {
  const { isSettingsOpen, toggleSettings, readingMode, setReadingMode, readingSize, setReadingSize, lineHeightMultiplier, setLineHeightMultiplier, contentWidth, setContentWidth, chineseFont, setChineseFont } = useReaderStore();

  const learningSize = useImmersionStore(s => s.learningSize);
  const setLearningSize = useImmersionStore(s => s.setLearningSize);
  const learningCount = useImmersionStore(s => s.learning.size);
  const knownCount = useImmersionStore(s => s.known.size);
  const statsBuilding = useImmersionStore(s => s.statsBuilding);

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
                className={`${styles.segmentedBtn} ${readingMode === 'vietnamese_first' ? styles.active : ''}`}
                onClick={() => setReadingMode('vietnamese_first')}
              >
                Việt + Hán
              </button>
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
                Tự đọc trước
              </button>
            </div>
            <p className={styles.modeHint}>
              {readingMode === 'vietnamese_first' && 'Đọc truyện bằng tiếng Việt. Một số từ hay gặp hiện bằng chữ Hán (có nghĩa ở trên); gặp đủ nhiều lần thì nghĩa được ẩn để bạn tự nhớ. Bấm vào chữ Hán để xem pinyin, âm Hán-Việt; bấm vào câu để xem câu gốc.'}
              {readingMode === 'bilingual' && 'Luôn hiện bản dịch. Dễ đọc nhưng mắt sẽ tự nhảy sang tiếng Việt — học ít hơn bạn nghĩ.'}
              {readingMode === 'chinese_only' && 'Chỉ tiếng Trung. Di chuột/chạm vào từ để tra nghĩa.'}
              {readingMode === 'on_demand' && 'Đọc câu tiếng Trung trước, tự đoán nghĩa, rồi bấm vào dòng mờ để kiểm tra. Cách này giúp nhớ lâu nhất.'}
            </p>
          </div>

          {readingMode === 'vietnamese_first' && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Số từ học cùng lúc</div>
              <div className={styles.segmented}>
                {LEARNING_SIZES.map(size => (
                  <button
                    key={size}
                    className={`${styles.segmentedBtn} ${learningSize === size ? styles.active : ''}`}
                    onClick={() => setLearningSize(size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <p className={styles.modeHint}>
                {statsBuilding
                  ? 'Đang thống kê từ trong sách…'
                  : `Đang học ${learningCount} từ · đã thuộc ${knownCount} từ. Từ mới được chọn theo độ phổ biến trong truyện; khi bạn thuộc một từ, từ tiếp theo sẽ xuất hiện.`}
              </p>
            </div>
          )}

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
            <div className={styles.sectionLabel}>Chiều rộng nội dung</div>
            <div className={styles.segmented}>
              {WIDTHS.map(([value, label]) => (
                <button
                  key={value}
                  className={`${styles.segmentedBtn} ${contentWidth === value ? styles.active : ''}`}
                  onClick={() => setContentWidth(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Font chữ Hán</div>
            <div className={styles.segmented}>
              {FONTS.map(([value, label, family]) => (
                <button
                  key={value}
                  className={`${styles.segmentedBtn} ${chineseFont === value ? styles.active : ''}`}
                  onClick={() => setChineseFont(value)}
                  style={{ fontFamily: family }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
