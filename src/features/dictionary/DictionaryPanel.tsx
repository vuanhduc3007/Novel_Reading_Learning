import React from 'react';
import { X, Sparkles, BookOpen, Check, RotateCcw } from 'lucide-react';
import { useDictionaryStore } from '../../stores/dictionaryStore';
import { useVocabularyStore } from '../../stores/vocabularyStore';
import { useReaderStore } from '../../stores/readerStore';
import { useImmersionStore } from '../../stores/immersionStore';
import { useToast } from '../../components/Toast/ToastContext';
import { Skeleton } from '../../components';
import styles from './DictionaryPanel.module.css';

export function DictionaryPanel() {
  const { isPanelOpen, closePanel, panelState, panelWord, panelResult, handleWordClick } = useDictionaryStore();
  const { bookId, bookTitle, currentSentenceId } = useReaderStore();
  const { knownWords, addWord, removeWord } = useVocabularyStore();
  const isKnown = panelWord ? knownWords.has(panelWord) : false;
  // Việt + chữ Hán: mark a word as known from the Chinese sentence, so it is
  // shown in Chinese from now on (wherever it pairs with the translation).
  const readingMode = useReaderStore(s => s.readingMode);
  const immersionReady = useImmersionStore(s => s.ready);
  const learnedStatus = useImmersionStore(s => (panelWord ? s.progress.get(panelWord)?.status : undefined));
  const setLearnedStatus = useImmersionStore(s => s.setStatus);
  const { showToast } = useToast();
  const canMarkKnown = Boolean(panelWord) && readingMode === 'vietnamese_first' && immersionReady;

  if (!isPanelOpen && !panelWord) return null;

  return (
    <>
      <div className={`${styles.backdrop} ${isPanelOpen ? styles.open : ''}`} onClick={closePanel} />
      <div className={`${styles.panel} ${isPanelOpen ? styles.open : ''}`}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Tra từ</span>
          <button className={styles.closeBtn} onClick={closePanel} aria-label="Close dictionary">
            <X size={20} />
          </button>
        </div>

        <div className={styles.body}>
          {panelState === 'loading' && (
            <div className={styles.loadingState}>
              <Skeleton width="120px" height="32px" />
              <Skeleton width="80px" height="20px" />
              <div style={{ height: 24 }} />
              <Skeleton width="100%" height="20px" />
              <Skeleton width="90%" height="20px" />
              <Skeleton width="70%" height="20px" />
            </div>
          )}

          {panelState === 'error' && (
            <div className={styles.errorState}>
              <p>Không thể tải từ điển lúc này.</p>
              <button className={styles.retryBtn} onClick={() => panelWord && void handleWordClick(panelWord)}>Thử lại</button>
            </div>
          )}

          {panelState === 'unavailable' && (
            <div className={styles.errorState}>
              <p>Không tìm thấy nghĩa của từ "{panelWord}".</p>
            </div>
          )}

          {canMarkKnown && panelState !== 'loading' && (
            learnedStatus === 'known' ? (
              <button
                className={`${styles.vocabBtn} ${styles.vocabBtnActive}`}
                onClick={() => {
                  setLearnedStatus(panelWord!, 'learning');
                  showToast(`${panelWord}: học lại từ đầu`, 'info');
                }}
                title="Bấm để học lại từ này"
              >
                <RotateCcw size={16} /> Đã thuộc · bấm để học lại
              </button>
            ) : (
              <button
                className={styles.vocabBtn}
                onClick={() => {
                  setLearnedStatus(panelWord!, 'known');
                  showToast(`${panelWord} sẽ hiện bằng chữ Hán ở những chỗ ghép được với bản dịch`, 'success');
                  closePanel();
                }}
              >
                <Check size={16} /> Đã thuộc – hiện chữ Hán
              </button>
            )
          )}

          {(panelState === 'complete' || panelState === 'complete_ai') && panelResult && (
            <div className={styles.result}>
              <div className={styles.wordHeader}>
                <h2 className={styles.word}>{panelResult.word}</h2>
                {panelState === 'complete_ai' && (
                  <span className={styles.aiBadge}>
                    <Sparkles size={12} /> AI Dịch
                  </span>
                )}
              </div>
              
              {panelResult.pinyin && <div className={styles.pinyin}>{panelResult.pinyin}</div>}
              
              <div className={styles.meaningBlock}>
                {panelResult.partOfSpeech && <span className={styles.pos}>[{panelResult.partOfSpeech}]</span>}
                <span className={styles.meaning}>{panelResult.meaning}</span>
              </div>

              {panelResult.examples.length > 0 && (
                <div className={styles.examples}>
                  <div className={styles.examplesLabel}>Ví dụ:</div>
                  {panelResult.examples.map((ex, i) => (
                    <div key={i} className={styles.exampleItem}>
                      <div className={styles.exChinese}>{ex.chinese}</div>
                      <div className={styles.exVietnamese}>{ex.vietnamese}</div>
                    </div>
                  ))}
                </div>
              )}

              <button 
                className={`${styles.vocabBtn} ${isKnown ? styles.vocabBtnActive : ''}`}
                onClick={() => {
                  if (isKnown) {
                    removeWord(panelWord!);
                  } else if (bookId) {
                    addWord(panelWord!, panelResult.pinyin || '', panelResult.meaning || '', panelResult.partOfSpeech, bookId, bookTitle, currentSentenceId);
                  }
                }}
                aria-label={isKnown ? "Đã lưu" : "Thêm vào từ vựng"}
              >
                <BookOpen size={16} /> {isKnown ? 'Đã lưu' : 'Thêm vào từ vựng'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
