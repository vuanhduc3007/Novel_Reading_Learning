import { db } from '../../db/database';
import { apiBaseUrl, useMockApi } from '../../config/apiConfig';
import type { DictionaryLookupResult, DictionarySource, DictionaryCompleteness } from '../../types';
import { LOCAL_DICT } from './localDictionary';

export { LOCAL_WORDS } from './localDictionary';

const inFlightExternalLookups = new Map<string, Promise<DictionaryLookupResult | null>>();

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Dictionary request timed out', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Dictionary API error: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isDictionaryResult(value: unknown): value is DictionaryLookupResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<DictionaryLookupResult>;
  const nullableString = (field: unknown) => field === null || typeof field === 'string';
  return typeof result.word === 'string'
    && nullableString(result.pinyin) && nullableString(result.meaning) && nullableString(result.partOfSpeech)
    && ['local', 'cache', 'external', 'llm'].includes(result.source || '')
    && ['complete', 'partial'].includes(result.completeness || '')
    && Number.isFinite(result.fetchedAt)
    && Array.isArray(result.examples)
    && result.examples.every(example => example && typeof example.chinese === 'string' && typeof example.vietnamese === 'string')
    && Array.isArray(result.relatedWords) && result.relatedWords.every(word => typeof word === 'string');
}

export async function lookupWord(word: string, allowExternal: boolean = false): Promise<DictionaryLookupResult | null> {
  // 1. Local Dictionary
  if (LOCAL_DICT[word]) {
    return {
      word,
      pinyin: LOCAL_DICT[word].pinyin || null,
      meaning: LOCAL_DICT[word].meaning || null,
      partOfSpeech: LOCAL_DICT[word].partOfSpeech || null,
      examples: [],
      relatedWords: [],
      source: 'local',
      completeness: 'complete',
      fetchedAt: Date.now(),
    };
  }

  // 2. Persistent Cache
  try {
    const cached = await db.dictionaryCache.get(word);
    if (cached && isDictionaryResult(cached.result) && cached.result.word === word) {
      return cached.result;
    }
  } catch (e) {
    console.error("Cache read error", e);
  }

  if (!allowExternal) {
    return null; // Quick hover stops here
  }

  const existingRequest = inFlightExternalLookups.get(word);
  if (existingRequest) return existingRequest;

  const request = (async (): Promise<DictionaryLookupResult | null> => {
    let apiResult: DictionaryLookupResult;

    if (useMockApi) {
      // 3. Mock External Provider (with delay)
      await new Promise(resolve => setTimeout(resolve, 800));
      apiResult = {
        word,
        pinyin: "mó nǐ",
        meaning: `[Generated] Mock meaning for ${word}`,
        partOfSpeech: "unknown",
        examples: [{ chinese: `${word}是个好词`, vietnamese: `${word} là một từ hay` }],
        relatedWords: [],
        source: 'llm',
        completeness: 'complete',
        fetchedAt: Date.now(),
      };
    } else {
      const data = await fetchJsonWithTimeout(`${apiBaseUrl}/api/dictionary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word })
      }, 10_000);

      if (data === null) return null;
      if (!isDictionaryResult(data) || data.word !== word) {
        throw new Error('Dictionary API returned a malformed response');
      }
      apiResult = data;
    }

    // 4. Save to Cache. A cache write failure must not discard a valid lookup.
    try {
      await db.dictionaryCache.put({ word, result: apiResult, cachedAt: Date.now() });
    } catch (error) {
      console.error('Dictionary cache write error', error);
    }

    return apiResult;
  })();

  inFlightExternalLookups.set(word, request);
  try {
    return await request;
  } finally {
    if (inFlightExternalLookups.get(word) === request) {
      inFlightExternalLookups.delete(word);
    }
  }
}
