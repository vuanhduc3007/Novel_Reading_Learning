import { apiBaseUrl, useMockApi } from '../../config/apiConfig';

export interface TranslationBatchItem {
  id: string;
  text: string;
}

export interface TranslationItemError {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export type TranslationBatchResult =
  | { id: string; status: 'translated'; translation: string }
  | { id: string; status: 'failed'; error: TranslationItemError };

export interface TranslationProvider {
  translate(text: string, signal?: AbortSignal): Promise<string>;
  translateBatch(items: TranslationBatchItem[], signal?: AbortSignal): Promise<TranslationBatchResult[]>;
}

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

export class TranslationProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    message = code,
  ) {
    super(message);
    this.name = 'TranslationProviderError';
  }
}

function waitWithAbort(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new DOMException('Translation cancelled', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Translation timed out', 'TimeoutError')), timeoutMs);
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    },
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function malformedItem(id: string): TranslationBatchResult {
  return {
    id,
    status: 'failed',
    error: {
      code: 'MALFORMED_API_RESPONSE',
      message: 'Translation API omitted or malformed this batch item',
      retryable: false,
    },
  };
}

export class MockTranslationProvider implements TranslationProvider {
  async translate(text: string, signal?: AbortSignal): Promise<string> {
    const [result] = await this.translateBatch([{ id: 'single', text }], signal);
    if (!result || result.status !== 'translated') throw new Error(result?.error.message || 'Mock translation failed');
    return result.translation;
  }

  async translateBatch(items: TranslationBatchItem[], signal?: AbortSignal): Promise<TranslationBatchResult[]> {
    await waitWithAbort(300 + Math.random() * 500, signal);
    if (Math.random() < 0.05) {
      throw new TranslationProviderError('PROVIDER_UNAVAILABLE', 503, true, undefined, 'Mock translation network error');
    }
    return items.map(item => ({ id: item.id, status: 'translated', translation: `[Bản dịch Mock] ${item.text}` }));
  }
}

let apiWarm = false;
let warmUpPromise: Promise<void> | null = null;

/** Wake a sleeping backend before the first translation batch needs it. */
export function warmUpTranslationApi(): Promise<void> {
  if (useMockApi || apiWarm) return Promise.resolve();
  warmUpPromise ??= fetch(`${apiBaseUrl}/api/health`, { method: 'GET' })
    .then(response => { if (response.ok) apiWarm = true; })
    .catch(() => undefined)
    .finally(() => { warmUpPromise = null; });
  return warmUpPromise;
}

export class ApiTranslationProvider implements TranslationProvider {
  async translate(text: string, signal?: AbortSignal): Promise<string> {
    const [result] = await this.translateBatch([{ id: 'single', text }], signal);
    if (!result || result.status !== 'translated') {
      const error: TranslationItemError = result?.status === 'failed' ? result.error : {
        code: 'MALFORMED_API_RESPONSE',
        message: 'Translation API omitted or malformed this batch item',
        retryable: false,
      };
      throw new TranslationProviderError(error.code, null, error.retryable, error.retryAfterMs, error.message);
    }
    return result.translation;
  }

  async translateBatch(items: TranslationBatchItem[], signal?: AbortSignal): Promise<TranslationBatchResult[]> {
    // The free Render instance sleeps when idle and needs up to ~50s to wake.
    // A 10s timeout used to burn every retry during that cold start and mark
    // the whole chapter as failed.
    const request = timeoutSignal(signal, apiWarm ? 20_000 : 60_000);
    try {
      const response = await fetch(`${apiBaseUrl}/api/translate/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({ items, sourceLanguage: 'zh', targetLanguage: 'vi' }),
      });

      if (!response.ok) {
        let payload: { error?: unknown; message?: unknown; retryAfterSeconds?: unknown } = {};
        try {
          payload = await response.json() as typeof payload;
        } catch {
          // The status and headers still provide a safe structured error.
        }
        const code = typeof payload.error === 'string' ? payload.error : `HTTP_${response.status}`;
        const retryAfterHeader = parseRetryAfter(response.headers.get('Retry-After'));
        const retryAfterBody = typeof payload.retryAfterSeconds === 'number' && payload.retryAfterSeconds >= 0
          ? payload.retryAfterSeconds * 1000
          : undefined;
        throw new TranslationProviderError(
          code,
          response.status,
          RETRYABLE_HTTP_STATUSES.has(response.status),
          retryAfterHeader ?? retryAfterBody,
          typeof payload.message === 'string' ? payload.message : `Translation API error: ${response.status}`,
        );
      }

      apiWarm = true;
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !Array.isArray((data as { results?: unknown }).results)) {
        throw new TranslationProviderError('MALFORMED_API_RESPONSE', 502, false);
      }

      const rawResults = (data as { results: unknown[] }).results;
      const resultById = new Map<string, TranslationBatchResult>();
      for (const raw of rawResults) {
        if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') continue;
        const candidate = raw as {
          id: string;
          status?: unknown;
          translation?: unknown;
          error?: { code?: unknown; message?: unknown; retryable?: unknown; retryAfterMs?: unknown };
        };
        if (candidate.status === 'translated' && typeof candidate.translation === 'string' && candidate.translation.trim()) {
          resultById.set(candidate.id, { id: candidate.id, status: 'translated', translation: candidate.translation });
        } else if (candidate.status === 'failed' && candidate.error && typeof candidate.error.code === 'string') {
          resultById.set(candidate.id, {
            id: candidate.id,
            status: 'failed',
            error: {
              code: candidate.error.code,
              message: typeof candidate.error.message === 'string' ? candidate.error.message : candidate.error.code,
              retryable: candidate.error.retryable === true,
              retryAfterMs: typeof candidate.error.retryAfterMs === 'number' ? candidate.error.retryAfterMs : undefined,
            },
          });
        }
      }

      // Preserve request order and turn an omitted item into an isolated failure
      // rather than shifting translations onto the wrong sentence.
      return items.map(item => resultById.get(item.id) ?? malformedItem(item.id));
    } catch (error) {
      if (error instanceof TranslationProviderError || signal?.aborted) throw error;
      if (request.signal.aborted) {
        throw new TranslationProviderError('TRANSLATION_TIMEOUT', 504, true, undefined, 'Translation request timed out');
      }
      throw new TranslationProviderError('NETWORK_ERROR', null, true, undefined, 'Translation network request failed');
    } finally {
      request.dispose();
    }
  }
}

export const translationProvider: TranslationProvider = useMockApi
  ? new MockTranslationProvider()
  : new ApiTranslationProvider();
