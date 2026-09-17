import React, { useCallback, memo } from 'react';
import { useDictionaryStore } from '../../stores/dictionaryStore';
import { useVocabularyStore } from '../../stores/vocabularyStore';
import styles from './WordToken.module.css';

interface WordTokenProps {
  word: string;
}

export const WordToken = memo(({ word }: WordTokenProps) => {
  const { handleWordHover, handleWordLeave, handleWordClick, panelWord } = useDictionaryStore();
  const isKnown = useVocabularyStore(s => s.knownWords.has(word));
  
  // Use a selector to know if this word is currently open in the panel
  const isActive = panelWord === word;

  const onMouseEnter = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    handleWordHover(word, { x: rect.left, y: rect.top, height: rect.height });
  }, [word, handleWordHover]);

  const onMouseLeave = useCallback(() => {
    handleWordLeave();
  }, [handleWordLeave]);

  const onClick = useCallback(() => {
    handleWordClick(word);
  }, [word, handleWordClick]);

  return (
    <span
      className={`${styles.token} ${isActive ? styles.active : ''} ${isKnown ? styles.known : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {word}
    </span>
  );
});
WordToken.displayName = 'WordToken';
