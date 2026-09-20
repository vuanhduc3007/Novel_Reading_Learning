import { db } from '../../db/database';
import { apiBaseUrl, useMockApi } from '../../config/apiConfig';
import type { DictionaryLookupResult, DictionarySource, DictionaryCompleteness } from '../../types';

// Minimal local dictionary for testing (based on test-book.txt)
const LOCAL_DICT: Record<string, Partial<DictionaryLookupResult>> = {
  "房间": { pinyin: "fáng jiān", meaning: "room", partOfSpeech: "noun" },
  "打开": { pinyin: "dǎ kāi", meaning: "to turn on / to open", partOfSpeech: "verb" },
  "安静": { pinyin: "ān jìng", meaning: "quiet", partOfSpeech: "adj" },
  "窗外": { pinyin: "chuāng wài", meaning: "outside the window", partOfSpeech: "noun" },
  "图书馆": { pinyin: "tú shū guǎn", meaning: "library", partOfSpeech: "noun" },
  "相遇": { pinyin: "xiāng yù", meaning: "to meet / to encounter", partOfSpeech: "verb" },
  "惊讶": { pinyin: "jīng yà", meaning: "surprised", partOfSpeech: "adj" },
  "你好": { pinyin: "nǐ hǎo", meaning: "hello", partOfSpeech: "phrase" },
  "故事": { pinyin: "gù shì", meaning: "story", partOfSpeech: "noun" },
  "结束": { pinyin: "jié shù", meaning: "to end / to finish", partOfSpeech: "verb" },
  "友谊": { pinyin: "yǒu yì", meaning: "friendship", partOfSpeech: "noun" },
  "开始": { pinyin: "kāi shǐ", meaning: "to begin / to start", partOfSpeech: "verb" },
  "慢慢": { pinyin: "màn màn", meaning: "slowly", partOfSpeech: "adv" },
};

// Export WORDS for the tokenizer to use
export const LOCAL_WORDS = new Set(Object.keys(LOCAL_DICT));

const inFlightExternalLookups = new Map<string, Promise<DictionaryLookupResult>>();

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Dictionary request timed out', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
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

  const request = (async (): Promise<DictionaryLookupResult> => {
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
