import { db } from '../../db/database';
import { useReaderStore } from '../../stores/readerStore';
import { translationProvider } from './TranslationProvider';
import type { Sentence } from '../../types';

class TranslationQueue {
  private queue: Sentence[] = [];
  private activeCount = 0;
  private readonly CONCURRENCY = 3;
  private pendingBooks = new Set<string>(); // Books allowed to translate

  enqueue(sentence: Sentence) {
    if (sentence.translationStatus === 'translating' || sentence.translationStatus === 'ready') return;
    if (this.queue.some(s => s.id === sentence.id)) return; // Already queued
    
    this.queue.push(sentence);
    this.pendingBooks.add(sentence.bookId);
    this.processNext();
  }

  cancelAllForBook(bookId: string) {
    this.pendingBooks.delete(bookId);
    this.queue = this.queue.filter(s => s.bookId !== bookId);
  }

  private async processNext() {
    if (this.activeCount >= this.CONCURRENCY || this.queue.length === 0) return;
    
    const sentence = this.queue.shift()!;
    if (!this.pendingBooks.has(sentence.bookId)) {
      // Cancelled
      this.processNext();
      return;
    }

    this.activeCount++;

    try {
      // 1. Mark as translating
      await db.sentences.update(sentence.id, { translationStatus: 'translating' });
      useReaderStore.getState().updateSentenceInStore(sentence.chapterId, sentence.id, { translationStatus: 'translating' });

      // 2. Fetch
      const translatedText = await translationProvider.translate(sentence.chineseText);

      // Check if cancelled during fetch
      if (!this.pendingBooks.has(sentence.bookId)) return;

      // 3. Mark as ready
      await db.sentences.update(sentence.id, { translationStatus: 'ready', vietnameseText: translatedText });
      useReaderStore.getState().updateSentenceInStore(sentence.chapterId, sentence.id, { translationStatus: 'ready', vietnameseText: translatedText });
    } catch (e) {
      if (this.pendingBooks.has(sentence.bookId)) {
        await db.sentences.update(sentence.id, { translationStatus: 'failed' });
        useReaderStore.getState().updateSentenceInStore(sentence.chapterId, sentence.id, { translationStatus: 'failed' });
      }
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }
}

export const translationQueue = new TranslationQueue();
