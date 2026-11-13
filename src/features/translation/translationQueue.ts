import { db } from '../../db/database';
import { useReaderStore } from '../../stores/readerStore';
import {
  TranslationProviderError,
  translationProvider,
  type TranslationBatchResult,
  type TranslationItemError,
} from './TranslationProvider';
import type { Sentence } from '../../types';

// Must match the gateway limits in server/index.js.
export const MAX_TRANSLATION_BATCH_ITEMS = 25;
export const MAX_TRANSLATION_BATCH_CHARACTERS = 2500;
const MAX_ATTEMPTS = 4;
const CONCURRENCY = 3;

type QueuePriority = -1 | 0 | 1 | 2;

interface QueueEntry {
  sentence: Sentence;
  generation: number;
  priority: QueuePriority;
  attempts: number;
  notBefore: number;
  sequence: number;
}

interface ActiveBatch {
  id: number;
  entries: QueueEntry[];
  controller: AbortController;
  startedAt: number;
  abortReason: 'navigation' | 'reader-unmount' | 'book-cancel' | null;
}

export interface TranslationSchedule {
  bookId: string;
  currentChapterId: string;
  current: Sentence[];
  next?: { chapterId: string; sentences: Sentence[] };
  previous?: { chapterId: string; sentences: Sentence[] };
  nearEnd: boolean;
}

export interface TranslationQueueMetrics {
  queued: number;
  active: number;
  attempts: number;
  batches: number;
  succeeded: number;
  failed: number;
  lastStatus: 'idle' | 'success' | 'partial' | 'retrying' | 'failed' | 'cancelled';
  lastErrorCode: string | null;
  lastLatencyMs: number | null;
  batchSizes: number[];
}

const RETRYABLE_CODES = new Set([
  'NETWORK_ERROR',
  'TRANSLATION_TIMEOUT',
  'RATE_LIMIT_EXCEEDED',
  'APP_RATE_LIMIT',
  'BAD_GATEWAY',
  'PROVIDER_UNAVAILABLE',
  'HTTP_429',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
]);

const telemetryEnabled = import.meta.env.DEV;

function isAutomaticallyRetryable(error: TranslationItemError | TranslationProviderError): boolean {
  if (!error.retryable) return false;
  if (error instanceof TranslationProviderError && error.status !== null) {
    return [429, 502, 503, 504].includes(error.status);
  }
  return RETRYABLE_CODES.has(error.code);
}

function batchItemCharacters(text: string): number {
  return text.length;
}

/** A human reference translation makes machine translation unnecessary. */
function hasReference(sentence: Sentence): boolean {
  return sentence.referenceText !== undefined && sentence.referenceText !== null;
}

class TranslationQueue {
  private queue: QueueEntry[] = [];
  private activeCount = 0;
  private sequence = 0;
  private batchSequence = 0;
  private processScheduled = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly bookGenerations = new Map<string, number>();
  private readonly queuedSentenceIds = new Set<string>();
  private readonly activeSentenceIds = new Set<string>();
  private readonly activeBatches = new Map<number, ActiveBatch>();
  // Failed rows persist in IndexedDB. Retry each one automatically once per
  // page session when it scrolls into the reading window, so a transient
  // outage (cold start, rate limit) does not leave a chapter untranslated.
  private readonly autoRecovered = new Set<string>();
  private metrics: TranslationQueueMetrics = {
    queued: 0,
    active: 0,
    attempts: 0,
    batches: 0,
    succeeded: 0,
    failed: 0,
    lastStatus: 'idle',
    lastErrorCode: null,
    lastLatencyMs: null,
    batchSizes: [],
  };

  enqueue(sentence: Sentence) {
    // Explicit enqueue calls are user/on-demand work and may recover a row left
    // in `translating` or `failed` after an interrupted session. Ready rows are
    // still filtered by addEntries and never reach the provider.
    this.addEntries([sentence], -1, 0, true);
  }

  retry(sentence: Sentence) {
    this.addEntries([{ ...sentence, translationStatus: 'failed' }], -1, 0, true);
  }

  syncReaderWindow(schedule: TranslationSchedule) {
    const allowedChapterIds = new Set([
      schedule.currentChapterId,
      schedule.next?.chapterId,
      schedule.previous?.chapterId,
    ].filter((value): value is string => Boolean(value)));

    this.queue = this.queue.filter(entry => {
      if (entry.sentence.bookId !== schedule.bookId || allowedChapterIds.has(entry.sentence.chapterId)) return true;
      this.queuedSentenceIds.delete(entry.sentence.id);
      return false;
    });

    for (const batch of this.activeBatches.values()) {
      if (batch.entries[0]?.sentence.bookId === schedule.bookId &&
          batch.entries.every(entry => !allowedChapterIds.has(entry.sentence.chapterId))) {
        batch.abortReason = 'navigation';
        batch.controller.abort();
      }
    }

    const priorityByChapter = new Map<string, QueuePriority>([
      [schedule.currentChapterId, 0],
      ...(schedule.next ? [[schedule.next.chapterId, 1] as [string, QueuePriority]] : []),
      ...(schedule.previous ? [[schedule.previous.chapterId, 2] as [string, QueuePriority]] : []),
    ]);
    for (const entry of this.queue) {
      if (entry.sentence.bookId === schedule.bookId) {
        entry.priority = priorityByChapter.get(entry.sentence.chapterId) ?? entry.priority;
      }
    }

    const recoverable = schedule.current.filter(sentence =>
      sentence.translationStatus === 'failed' && !hasReference(sentence) && !this.autoRecovered.has(sentence.id));
    for (const sentence of recoverable) this.autoRecovered.add(sentence.id);
    if (recoverable.length > 0) this.addEntries(recoverable, 0, 0, true, false);

    const currentPending = schedule.current.some(sentence => !hasReference(sentence) &&
      (sentence.translationStatus === 'not_translated' || sentence.translationStatus === 'translating'));
    this.addEntries(schedule.current, 0, 0, false, false);

    if (schedule.nearEnd || !currentPending) {
      if (schedule.next) this.addEntries(schedule.next.sentences, 1, 0, false, false);
    }
    if (!currentPending && schedule.previous) {
      this.addEntries(schedule.previous.sentences, 2, 0, false, false);
    }

    this.refreshMetricCounts();
    this.requestProcess();
  }

  stopForReader(bookId: string) {
    this.queue = this.queue.filter(entry => {
      if (entry.sentence.bookId !== bookId) return true;
      this.queuedSentenceIds.delete(entry.sentence.id);
      return false;
    });
    for (const batch of this.activeBatches.values()) {
      if (batch.entries[0]?.sentence.bookId === bookId) {
        batch.abortReason = 'reader-unmount';
        batch.controller.abort();
      }
    }
    this.setTelemetry({ lastStatus: 'cancelled' });
    this.refreshMetricCounts();
    this.scheduleRetryWakeup();
  }

  cancelAllForBook(bookId: string) {
    this.bookGenerations.set(bookId, (this.bookGenerations.get(bookId) ?? 0) + 1);
    this.queue = this.queue.filter(entry => {
      if (entry.sentence.bookId !== bookId) return true;
      this.queuedSentenceIds.delete(entry.sentence.id);
      return false;
    });
    for (const batch of this.activeBatches.values()) {
      if (batch.entries[0]?.sentence.bookId === bookId) {
        batch.abortReason = 'book-cancel';
        batch.controller.abort();
      }
    }
    this.setTelemetry({ lastStatus: 'cancelled' });
    this.refreshMetricCounts();
    this.scheduleRetryWakeup();
  }

  getMetrics(): TranslationQueueMetrics {
    this.refreshMetricCounts();
    return { ...this.metrics, batchSizes: [...this.metrics.batchSizes] };
  }

  getDebugState() {
    return {
      queued: this.queue.map(entry => ({
        sentenceId: entry.sentence.id,
        chapterId: entry.sentence.chapterId,
        priority: entry.priority,
        attempts: entry.attempts,
        notBefore: entry.notBefore,
      })),
      active: [...this.activeBatches.values()].map(batch => ({
        sentenceIds: batch.entries.map(entry => entry.sentence.id),
        chapterId: batch.entries[0]?.sentence.chapterId ?? null,
      })),
    };
  }

  resetMetrics() {
    this.metrics = {
      queued: this.queue.length,
      active: this.activeCount,
      attempts: 0,
      batches: 0,
      succeeded: 0,
      failed: 0,
      lastStatus: 'idle',
      lastErrorCode: null,
      lastLatencyMs: null,
      batchSizes: [],
    };
  }

  private addEntries(
    sentences: Sentence[],
    priority: QueuePriority,
    attempts: number,
    force = false,
    process = true,
  ) {
    const generationByBook = new Map<string, number>();
    for (const sentence of sentences) {
      if (!force && sentence.translationStatus !== 'not_translated' && sentence.translationStatus !== 'translating') continue;
      if (sentence.translationStatus === 'ready' || hasReference(sentence)) continue;
      if (this.queuedSentenceIds.has(sentence.id) || this.activeSentenceIds.has(sentence.id)) continue;
      const generation = generationByBook.get(sentence.bookId) ?? this.bookGenerations.get(sentence.bookId) ?? 0;
      generationByBook.set(sentence.bookId, generation);
      this.queue.push({ sentence, generation, priority, attempts, notBefore: 0, sequence: this.sequence++ });
      this.queuedSentenceIds.add(sentence.id);
    }
    this.refreshMetricCounts();
    if (process) this.requestProcess();
  }

  private isCurrent(entry: QueueEntry): boolean {
    return (this.bookGenerations.get(entry.sentence.bookId) ?? 0) === entry.generation;
  }

  private requestProcess() {
    if (this.processScheduled) return;
    this.processScheduled = true;
    queueMicrotask(() => {
      this.processScheduled = false;
      this.processNext();
    });
  }

  private processNext() {
    while (this.activeCount < CONCURRENCY) {
      const entries = this.takeNextBatch();
      if (entries.length === 0) break;
      const batch: ActiveBatch = {
        id: this.batchSequence++,
        entries,
        controller: new AbortController(),
        startedAt: performance.now(),
        abortReason: null,
      };
      this.activeCount++;
      this.activeBatches.set(batch.id, batch);
      for (const entry of entries) this.activeSentenceIds.add(entry.sentence.id);
      this.recordBatchStart(entries.length);
      void this.translateBatch(batch).finally(() => {
        for (const entry of entries) this.activeSentenceIds.delete(entry.sentence.id);
        this.activeBatches.delete(batch.id);
        this.activeCount--;
        this.refreshMetricCounts();
        this.requestProcess();
      });
    }
    this.refreshMetricCounts();
    this.scheduleRetryWakeup();
  }

  private takeNextBatch(): QueueEntry[] {
    const now = Date.now();
    let firstIndex = -1;
    for (let index = 0; index < this.queue.length; index++) {
      const entry = this.queue[index]!;
      if (!this.isCurrent(entry)) {
        this.queue.splice(index--, 1);
        this.queuedSentenceIds.delete(entry.sentence.id);
        continue;
      }
      if (entry.notBefore > now) continue;
      if (firstIndex < 0) firstIndex = index;
      else {
        const first = this.queue[firstIndex]!;
        if (entry.priority < first.priority || (entry.priority === first.priority && entry.sequence < first.sequence)) {
          firstIndex = index;
        }
      }
    }
    if (firstIndex < 0) return [];

    const first = this.queue.splice(firstIndex, 1)[0]!;
    this.queuedSentenceIds.delete(first.sentence.id);
    const batch = [first];
    let characters = batchItemCharacters(first.sentence.chineseText);

    for (let index = 0; index < this.queue.length && batch.length < MAX_TRANSLATION_BATCH_ITEMS;) {
      const candidate = this.queue[index]!;
      const compatible = candidate.notBefore <= now && candidate.priority === first.priority &&
        candidate.generation === first.generation && candidate.sentence.bookId === first.sentence.bookId &&
        candidate.sentence.chapterId === first.sentence.chapterId;
      if (!compatible) {
        index++;
        continue;
      }
      const itemCharacters = batchItemCharacters(candidate.sentence.chineseText);
      if (characters + itemCharacters > MAX_TRANSLATION_BATCH_CHARACTERS) {
        index++;
        continue;
      }
      batch.push(candidate);
      characters += itemCharacters;
      this.queue.splice(index, 1);
      this.queuedSentenceIds.delete(candidate.sentence.id);
    }
    return batch;
  }

  private async translateBatch(batch: ActiveBatch) {
    const validEntries: QueueEntry[] = [];
    try {
      for (const entry of batch.entries) {
        const stored = await db.sentences.get(entry.sentence.id);
        if (!stored || !this.isCurrent(entry) || stored.translationStatus === 'ready' || hasReference(stored) ||
            stored.bookId !== entry.sentence.bookId || stored.chapterId !== entry.sentence.chapterId) continue;
        const updated = await db.sentences.update(stored.id, {
          translationStatus: 'translating',
          translationErrorCode: null,
          translationRetryAt: null,
        });
        if (!updated || !this.isCurrent(entry)) continue;
        entry.sentence = stored;
        entry.attempts++;
        validEntries.push(entry);
        useReaderStore.getState().updateSentenceInStore(stored.chapterId, stored.id, {
          translationStatus: 'translating',
          translationErrorCode: null,
          translationRetryAt: null,
        });
      }

      if (validEntries.length === 0 || batch.controller.signal.aborted) return;
      const results = await translationProvider.translateBatch(
        validEntries.map(entry => ({ id: entry.sentence.id, text: entry.sentence.chineseText })),
        batch.controller.signal,
      );
      const resultById = new Map(results.map(result => [result.id, result]));

      let failedItems = 0;
      for (const entry of validEntries) {
        const result = resultById.get(entry.sentence.id) ?? {
          id: entry.sentence.id,
          status: 'failed',
          error: { code: 'MALFORMED_API_RESPONSE', message: 'Missing batch result', retryable: false },
        } satisfies TranslationBatchResult;
        if (result.status === 'translated') {
          await this.persistSuccess(entry, result.translation);
        } else {
          failedItems++;
          await this.handleFailure(entry, result.error);
        }
      }
      this.setTelemetry({
        lastStatus: failedItems === 0 ? 'success' : failedItems === validEntries.length ? 'failed' : 'partial',
        lastErrorCode: failedItems === 0 ? null : 'PARTIAL_BATCH_FAILURE',
        lastLatencyMs: Math.round(performance.now() - batch.startedAt),
      });
    } catch (error) {
      if (batch.controller.signal.aborted) {
        if (batch.abortReason !== 'book-cancel') {
          for (const entry of validEntries) await this.resetCancelledEntry(entry);
        }
        this.setTelemetry({ lastStatus: 'cancelled', lastLatencyMs: Math.round(performance.now() - batch.startedAt) });
        return;
      }
      const normalized = error instanceof TranslationProviderError
        ? error
        : new TranslationProviderError('UNKNOWN_ERROR', null, false, undefined, 'Unexpected translation failure');
      for (const entry of validEntries) await this.handleFailure(entry, normalized);
      this.setTelemetry({
        lastStatus: isAutomaticallyRetryable(normalized) ? 'retrying' : 'failed',
        lastErrorCode: normalized.code,
        lastLatencyMs: Math.round(performance.now() - batch.startedAt),
      });
    }
  }

  private async persistSuccess(entry: QueueEntry, translation: string) {
    const stored = await db.sentences.get(entry.sentence.id);
    if (!stored || !this.isCurrent(entry) || stored.translationStatus !== 'translating' ||
        stored.bookId !== entry.sentence.bookId || stored.chapterId !== entry.sentence.chapterId ||
        stored.chineseText !== entry.sentence.chineseText) return;
    const updated = await db.sentences.update(stored.id, {
      translationStatus: 'ready',
      vietnameseText: translation,
      translationErrorCode: null,
      translationRetryAt: null,
    });
    if (updated && this.isCurrent(entry)) {
      useReaderStore.getState().updateSentenceInStore(stored.chapterId, stored.id, {
        translationStatus: 'ready',
        vietnameseText: translation,
        translationErrorCode: null,
        translationRetryAt: null,
      });
      this.setTelemetry({ succeeded: this.metrics.succeeded + 1 });
    }
  }

  private async handleFailure(entry: QueueEntry, error: TranslationItemError | TranslationProviderError) {
    const stored = await db.sentences.get(entry.sentence.id);
    if (!stored || !this.isCurrent(entry) || stored.translationStatus !== 'translating' ||
        stored.bookId !== entry.sentence.bookId || stored.chapterId !== entry.sentence.chapterId ||
        stored.chineseText !== entry.sentence.chineseText) return;

    if (isAutomaticallyRetryable(error) && entry.attempts < MAX_ATTEMPTS) {
      const retryAt = Date.now() + this.retryDelay(entry.attempts, error.retryAfterMs);
      const updates: Partial<Sentence> = {
        translationStatus: 'translating',
        translationErrorCode: error.code,
        translationRetryAt: retryAt,
      };
      await db.sentences.update(stored.id, updates);
      if (!this.isCurrent(entry)) return;
      useReaderStore.getState().updateSentenceInStore(stored.chapterId, stored.id, updates);
      entry.sentence = { ...stored, ...updates };
      entry.notBefore = retryAt;
      entry.sequence = this.sequence++;
      this.queue.push(entry);
      this.queuedSentenceIds.add(stored.id);
      this.setTelemetry({ lastStatus: 'retrying', lastErrorCode: error.code });
      return;
    }

    const updates: Partial<Sentence> = {
      translationStatus: 'failed',
      translationErrorCode: error.code,
      translationRetryAt: null,
    };
    const updated = await db.sentences.update(stored.id, updates);
    if (updated && this.isCurrent(entry)) {
      useReaderStore.getState().updateSentenceInStore(stored.chapterId, stored.id, updates);
      this.setTelemetry({ failed: this.metrics.failed + 1, lastStatus: 'failed', lastErrorCode: error.code });
    }
  }

  private async resetCancelledEntry(entry: QueueEntry) {
    const stored = await db.sentences.get(entry.sentence.id);
    if (!stored || !this.isCurrent(entry) || stored.translationStatus !== 'translating') return;
    const updates: Partial<Sentence> = {
      translationStatus: 'not_translated',
      translationErrorCode: null,
      translationRetryAt: null,
    };
    const updated = await db.sentences.update(stored.id, updates);
    if (updated && this.isCurrent(entry)) {
      useReaderStore.getState().updateSentenceInStore(stored.chapterId, stored.id, updates);
    }
  }

  private retryDelay(attempts: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return Math.max(0, retryAfterMs);
    const base = Math.min(1000 * (2 ** Math.max(0, attempts - 1)), 8000);
    return Math.round(base * (0.75 + Math.random() * 0.5));
  }

  private scheduleRetryWakeup() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.activeCount >= CONCURRENCY) return;
    const future = this.queue
      .filter(entry => this.isCurrent(entry) && entry.notBefore > Date.now())
      .reduce((earliest, entry) => Math.min(earliest, entry.notBefore), Infinity);
    if (Number.isFinite(future)) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.requestProcess();
      }, Math.max(0, future - Date.now()));
    }
  }

  private recordBatchStart(size: number) {
    if (!telemetryEnabled) return;
    this.metrics.attempts++;
    this.metrics.batches++;
    this.metrics.batchSizes = [...this.metrics.batchSizes.slice(-99), size];
  }

  private setTelemetry(updates: Partial<TranslationQueueMetrics>) {
    if (!telemetryEnabled) return;
    this.metrics = { ...this.metrics, ...updates };
  }

  private refreshMetricCounts() {
    this.metrics.queued = this.queue.length;
    this.metrics.active = this.activeCount;
  }
}

export const translationQueue = new TranslationQueue();
