import React from 'react';
import { createPortal } from 'react-dom';
import { useDictionaryStore } from '../../stores/dictionaryStore';
import styles from './DictionaryTooltip.module.css';

export function DictionaryTooltip() {
  const { hoveredWord, hoverPosition, tooltipResult } = useDictionaryStore();

  if (!hoveredWord || !hoverPosition) return null;

  // Simple positioning logic
  const isTop = hoverPosition.y > 100; // if enough space above
  const top = isTop ? hoverPosition.y - 10 : hoverPosition.y + hoverPosition.height + 10;
  
  return createPortal(
    <div 
      className={`${styles.tooltip} ${isTop ? styles.positionTop : styles.positionBottom}`}
      style={{ left: hoverPosition.x, top }}
    >
      <div className={styles.wordRow}>
        <span className={styles.word}>{hoveredWord}</span>
        {tooltipResult?.pinyin && <span className={styles.pinyin}>{tooltipResult.pinyin}</span>}
      </div>
      
      {tooltipResult ? (
        <div className={styles.meaningRow}>
          {tooltipResult.partOfSpeech && (
            <span className={styles.pos}>[{tooltipResult.partOfSpeech}]</span>
          )}
          <span className={styles.meaning}>{tooltipResult.meaning}</span>
        </div>
      ) : (
        <div className={styles.hint}>Nhấn để tra cứu đầy đủ</div>
      )}
    </div>,
    document.body
  );
}
