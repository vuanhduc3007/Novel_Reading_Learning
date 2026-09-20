import { apiBaseUrl, useMockApi } from '../../config/apiConfig';

export interface TranslationProvider {
  translate(text: string, signal?: AbortSignal): Promise<string>;
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

export class MockTranslationProvider implements TranslationProvider {
  async translate(text: string, signal?: AbortSignal): Promise<string> {
    // Simulate network delay (300ms - 800ms)
    const delay = 300 + Math.random() * 500;
    await waitWithAbort(delay, signal);
    
    // Simulate rare failure (5% chance)
    if (Math.random() < 0.05) {
      throw new Error('Mock translation network error');
    }

    return `[Bản dịch Mock] ${text}`;
  }
}

export class ApiTranslationProvider implements TranslationProvider {
  async translate(text: string, signal?: AbortSignal): Promise<string> {
    const request = timeoutSignal(signal, 10_000);
    try {
      const response = await fetch(`${apiBaseUrl}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({ text, sourceLanguage: 'zh', targetLanguage: 'vi' })
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || typeof (data as { translation?: unknown }).translation !== 'string'
          || !(data as { translation: string }).translation.trim()) {
        throw new Error('Translation API returned a malformed response');
      }
      return (data as { translation: string }).translation;
    } finally {
      request.dispose();
    }
  }
}

export const translationProvider = useMockApi
  ? new MockTranslationProvider() 
  : new ApiTranslationProvider();
