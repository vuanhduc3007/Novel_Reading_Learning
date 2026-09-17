import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { db } from '../../db/database';
import { useVocabularyStore } from '../../stores/vocabularyStore';
import styles from './VocabularyPage.module.css';

export function VocabularyPage() {
  const items = useLiveQuery(() => db.vocabularyItems.orderBy('addedAt').reverse().toArray());
  const removeWord = useVocabularyStore(s => s.removeWord);

  const handleDelete = (word: string) => {
    removeWord(word);
  };

  if (!items) {
    return <div className={styles.loading}>Đang tải...</div>;
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <h2>Chưa có từ vựng nào</h2>
        <p>Khi đọc sách, hãy chọn từ vựng bạn muốn học và nhấn "Thêm vào từ vựng".</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Từ vựng của tôi</h1>
        <div className={styles.count}>{items.length} từ</div>
      </header>
      
      <div className={styles.grid}>
        {items.map(item => (
          <div key={item.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.wordInfo}>
                <h3 className={styles.word}>{item.word}</h3>
                {item.pinyin && <span className={styles.pinyin}>{item.pinyin}</span>}
              </div>
              <button 
                className={styles.deleteBtn} 
                onClick={() => handleDelete(item.word)}
                aria-label="Delete word"
              >
                <Trash2 size={16} />
              </button>
            </div>
            
            <div className={styles.meaning}>
              {item.partOfSpeech && <span className={styles.pos}>[{item.partOfSpeech}]</span>}
              {item.meaning}
            </div>
            
            <div className={styles.source}>
              Nguồn:{' '}
              {item.sourceBookAvailable ? (
                <span className={styles.bookTitle}>{item.sourceBookTitle}</span>
              ) : (
                <>
                  <span className={styles.deletedBook}>{item.sourceBookTitle}</span>
                  <span className={styles.deletedTag}>Sách đã xóa</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
