import { create } from 'zustand';
import { db } from '../db/database';
import { generateId } from '../utils/id';

interface VocabularyState {
  knownWords: Set<string>;
  init: () => Promise<void>;
  addWord: (word: string, pinyin: string, meaning: string, pos: string | null, bookId: string, bookTitle: string, sentenceId: string | null) => Promise<void>;
  removeWord: (word: string) => Promise<void>;
}

export const useVocabularyStore = create<VocabularyState>((set, get) => ({
  knownWords: new Set(),
  
  init: async () => {
    const items = await db.vocabularyItems.toArray();
    const words = new Set(items.map(item => item.word));
    set({ knownWords: words });
  },

  addWord: async (word, pinyin, meaning, pos, bookId, bookTitle, sentenceId) => {
    const existing = await db.vocabularyItems.where('word').equals(word).first();
    if (existing) return;

    await db.vocabularyItems.add({
      id: generateId(),
      word,
      pinyin,
      meaning,
      partOfSpeech: pos,
      sourceBookId: bookId,
      sourceBookTitle: bookTitle,
      sourceBookAvailable: true,
      sourceSentenceId: sentenceId,
      isKnown: true,
      addedAt: Date.now(),
    });

    const newSet = new Set(get().knownWords);
    newSet.add(word);
    set({ knownWords: newSet });
  },

  removeWord: async (word) => {
    const item = await db.vocabularyItems.where('word').equals(word).first();
    if (item) {
      await db.vocabularyItems.delete(item.id);
      const newSet = new Set(get().knownWords);
      newSet.delete(word);
      set({ knownWords: newSet });
    }
  },
}));
