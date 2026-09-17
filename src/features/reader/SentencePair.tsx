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
  
  const renderTranslation = () => {
    if (readingMode === 'chinese_only') return null;
    
    const { translationStatus, vietnameseText } = sentence;
    
    if (readingMode === 'on_demand') {
      if (translationStatus === 'not_translated' || translationStatus === 'failed') {
        return (
          <button className={styles.onDemandToggle} onClick={() => translationQueue.enqueue(sentence)}>
            <ChevronDown size={12} /> Xem bản dịch
          </button>
        );
      }
      if (translationStatus === 'translating') {
        return <span className={styles.translating}>Đang dịch…</span>;
      }
      if (translationStatus === 'ready' && !showTranslation) {
        return (
          <button className={styles.onDemandToggle} onClick={() => setShowTranslation(true)}>
            <ChevronDown size={12} /> Hiện bản dịch
          </button>
        );
      }
      // If ready and showTranslation === true, it will fall through to render vietnameseText below
    } else if (readingMode === 'bilingual') {
      if (translationStatus === 'not_translated') return null;
      if (translationStatus === 'translating') return <span className={styles.translating}>Đang dịch…</span>;
      if (translationStatus === 'failed') {
        return (
          <span className={styles.failed} onClick={() => translationQueue.enqueue(sentence)} style={{ cursor: 'pointer' }}>
            <RotateCcw size={12} /> Thử lại
          </span>
        );
      }
    }
    
    if (translationStatus === 'ready') {
      return <p className={styles.vietnamese}>{vietnameseText}</p>;
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
