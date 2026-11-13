import React, { useState, useMemo } from 'react';
import { RotateCcw, ChevronDown } from 'lucide-react';
import type { Sentence, ReadingMode } from '../../types';
import { tokenize } from '../../utils/tokenizer';
import { WordToken } from '../dictionary/WordToken';
import { translationQueue } from '../translation/translationQueue';
import styles from './SentencePair.module.css';

interface SentencePairProps {
  sentence: Sentence;
  readingMode: ReadingMode;
}

export function SentencePair({ sentence, readingMode }: SentencePairProps) {
  const [showTranslation, setShowTranslation] = useState(false);
  
  // Tokenize the Chinese text
  const tokens = useMemo(() => tokenize(sentence.chineseText), [sentence.chineseText]);

  const retryLabel = () => {
    if (sentence.translationErrorCode === 'APP_RATE_LIMIT' || sentence.translationErrorCode === 'RATE_LIMIT_EXCEEDED') {
      return 'Tạm giới hạn — Thử lại';
    }
    if (sentence.translationErrorCode === 'TRANSLATION_TIMEOUT' || sentence.translationErrorCode === 'NETWORK_ERROR') {
      return 'Kết nối chậm — Thử lại';
    }
    return 'Thử lại';
  };
  
  const hasReference = sentence.referenceText !== undefined && sentence.referenceText !== null;
  // Human reference translation wins over machine translation.
  const translationText = hasReference
    ? sentence.referenceText
    : sentence.translationStatus === 'ready' ? sentence.vietnameseText : null;

  const renderTranslation = () => {
    if (readingMode === 'chinese_only') return null;
    // An empty reference means the translator merged this sentence into the
    // next one; its meaning is shown there.
    if (hasReference && !translationText) return null;

    if (translationText) {
      const sourceClass = hasReference ? styles.reference : '';
      if (readingMode === 'on_demand' && !showTranslation) {
        return (
          <button
            type="button"
            className={`${styles.vietnamese} ${styles.hidden} ${sourceClass}`}
            onClick={() => setShowTranslation(true)}
            aria-label="Hiện bản dịch"
            title="Đọc và tự hiểu câu tiếng Trung trước, rồi bấm để kiểm tra"
          >
            {translationText}
          </button>
        );
      }
      return (
        <p
          className={`${styles.vietnamese} ${sourceClass}`}
          onClick={readingMode === 'on_demand' ? () => setShowTranslation(false) : undefined}
        >
          {translationText}
        </p>
      );
    }

    const { translationStatus } = sentence;
    if (translationStatus === 'translating') {
      return <span className={styles.translating}>{sentence.translationRetryAt ? 'Đang chờ thử lại…' : 'Đang dịch…'}</span>;
    }
    if (translationStatus === 'failed') {
      return (
        <button className={styles.failed} onClick={() => translationQueue.retry(sentence)}>
          <RotateCcw size={12} /> {retryLabel()}
        </button>
      );
    }
    if (readingMode === 'on_demand') {
      return (
        <button className={styles.onDemandToggle} onClick={() => { setShowTranslation(true); translationQueue.enqueue(sentence); }}>
          <ChevronDown size={12} /> Xem bản dịch
        </button>
      );
    }
    return null;
  };

  return (
    <div
      className={styles.pair}
      data-sentence-id={sentence.id}
      data-chapter-id={sentence.chapterId}
    >
      <p className={styles.chinese}>
        {tokens.map((token, index) => 
          token.isWord ? (
            <WordToken key={index} word={token.text} />
          ) : (
            <span key={index}>{token.text}</span>
          )
        )}
      </p>
      {renderTranslation()}
    </div>
  );
}
