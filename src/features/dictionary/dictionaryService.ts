import { db } from '../../db/database';
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
    if (cached) {
      return cached.result;
    }
  } catch (e) {
    console.error("Cache read error", e);
  }

  if (!allowExternal) {
    return null; // Quick hover stops here
  }

  const useMock = import.meta.env.VITE_USE_MOCK_API === 'true' || import.meta.env.VITE_USE_MOCK_API === undefined;

  let apiResult: DictionaryLookupResult;

  if (useMock) {
    // 3. Mock External Provider (with delay)
    await new Promise(resolve => setTimeout(resolve, 800)); // Network delay simulation

    apiResult = {
      word,
      pinyin: "mó nǐ",
      meaning: `[Generated] Mock meaning for ${word}`,
      partOfSpeech: "unknown",
      examples: [{ chinese: `${word}是个好词`, vietnamese: `${word} là một từ hay` }],
      relatedWords: [],
      source: 'llm', // marking as AI generated
      completeness: 'complete',
      fetchedAt: Date.now(),
    };
  } else {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
      const response = await fetch(`${API_BASE_URL}/api/dictionary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ word })
      });

      if (!response.ok) {
        throw new Error(`Dictionary API error: ${response.status}`);
      }
      
      const data = await response.json();
      apiResult = data;
    } catch (e) {
      console.error("External Dictionary API error", e);
      throw e; // Throw to trigger failed state in UI
    }
  }

  // 4. Save to Cache
  try {
    await db.dictionaryCache.put({
      word,
      result: apiResult,
      cachedAt: Date.now(),
    });
  } catch (e) {
    console.error("Cache write error", e);
  }

  return apiResult;
}
