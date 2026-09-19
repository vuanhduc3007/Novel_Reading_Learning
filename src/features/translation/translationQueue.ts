import { db } from '../../db/database';
import { useReaderStore } from '../../stores/readerStore';
import { translationProvider } from './TranslationProvider';
import type { Sentence } from '../../types';

interface QueueEntry {
  sentence: Sentence;
  generation: number;
}

class TranslationQueue {
  private queue: QueueEntry[] = [];
  private activeCount = 0;
  private readonly CONCURRENCY = 3;
  private readonly bookGenerations = new Map<string, number>();
  private readonly queuedSentenceIds = new Set<string>();
  private readonly activeRequests = new Map<string, { bookId: string; generation: number; controller: AbortController }>();

  enqueue(sentence: Sentence) {
    if (sentence.translationStatus === 'ready') return;
    if (this.queuedSentenceIds.has(sentence.id) || this.activeRequests.has(sentence.id)) return;

    const generation = this.bookGenerations.get(sentence.bookId) ?? 0;
    this.queue.push({ sentence, generation });
    this.queuedSentenceIds.add(sentence.id);
    this.processNext();
  }

  cancelAllForBook(bookId: string) {
    this.bookGenerations.set(bookId, (this.bookGenerations.get(bookId) ?? 0) + 1);
    this.queue = this.queue.filter(entry => {
      if (entry.sentence.bookId !== bookId) return true;
      this.queuedSentenceIds.delete(entry.sentence.id);
      return false;
    });
    for (const request of this.activeRequests.values()) {
      if (request.bookId === bookId) request.controller.abort();
    }
  }

  private isCurrent(entry: QueueEntry): boolean {
    return (this.bookGenerations.get(entry.sentence.bookId) ?? 0) === entry.generation;
  }

  private processNext() {
    while (this.activeCount < this.CONCURRENCY && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.queuedSentenceIds.delete(entry.sentence.id);
      if (!this.isCurrent(entry)) continue;
      this.activeCount++;
      void this.translate(entry).finally(() => {
        this.activeCount--;
        this.processNext();
      });
    }
  }

  private async translate(entry: QueueEntry) {
    const { sentence } = entry;
    const controller = new AbortController();
    this.activeRequests.set(sentence.id, { bookId: sentence.bookId, generation: entry.generation, controller });

    try {
      // Re-read persistent state: a stale React object must never retranslate a
      // cached sentence, nor should a deleted/replaced sentence reach a provider.
      const stored = await db.sentences.get(sentence.id);
      if (!stored || !this.isCurrent(entry) || stored.translationStatus === 'ready') return;

      await db.sentences.update(sentence.id, { translationStatus: 'translating' });
      if (!this.isCurrent(entry)) return;
      useReaderStore.getState().updateSentenceInStore(sentence.chapterId, sentence.id, { translationStatus: 'translating' });

      const translatedText = await translationProvider.translate(sentence.chineseText, controller.signal);
      if (!this.isCurrent(entry)) return;

      const updated = await db.sentences.update(sentence.id, { translationStatus: 'ready', vietnameseText: translatedText });
      if (updated && this.isCurrent(entry)) {
        useReaderStore.getState().updateSentenceInStore(sentence.chapterId, sentence.id, { translationStatus: 'ready', vietnameseText: translatedText });
      }
    } catch {
      if (!this.isCurrent(entry) || controller.signal.aborted) return;
      const updated = await db.sentences.update(sentence.id, { translationStatus: 'failed' });
      if (updated && this.isCurrent(entry)) {
        useReaderStore.getState().updateSentenceInStore(sentence.chapterId, sentence.id, { translationStatus: 'failed' });
      }
    } finally {
      this.activeRequests.delete(sentence.id);
    }
  }
}

export const translationQueue = new TranslationQueue();
