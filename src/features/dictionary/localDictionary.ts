import type { DictionaryLookupResult } from '../../types';

// Small offline dictionary used by hover and as the first lookup tier.
export const LOCAL_DICT: Readonly<Record<string, Partial<DictionaryLookupResult>>> = {
  '房间': { pinyin: 'fáng jiān', meaning: 'room', partOfSpeech: 'noun' },
  '打开': { pinyin: 'dǎ kāi', meaning: 'to turn on / to open', partOfSpeech: 'verb' },
  '安静': { pinyin: 'ān jìng', meaning: 'quiet', partOfSpeech: 'adj' },
  '窗外': { pinyin: 'chuāng wài', meaning: 'outside the window', partOfSpeech: 'noun' },
  '图书馆': { pinyin: 'tú shū guǎn', meaning: 'library', partOfSpeech: 'noun' },
  '相遇': { pinyin: 'xiāng yù', meaning: 'to meet / to encounter', partOfSpeech: 'verb' },
  '惊讶': { pinyin: 'jīng yà', meaning: 'surprised', partOfSpeech: 'adj' },
  '你好': { pinyin: 'nǐ hǎo', meaning: 'hello', partOfSpeech: 'phrase' },
  '故事': { pinyin: 'gù shì', meaning: 'story', partOfSpeech: 'noun' },
  '结束': { pinyin: 'jié shù', meaning: 'to end / to finish', partOfSpeech: 'verb' },
  '友谊': { pinyin: 'yǒu yì', meaning: 'friendship', partOfSpeech: 'noun' },
  '开始': { pinyin: 'kāi shǐ', meaning: 'to begin / to start', partOfSpeech: 'verb' },
  '慢慢': { pinyin: 'màn màn', meaning: 'slowly', partOfSpeech: 'adv' },
};

export const LOCAL_WORDS = new Set(Object.keys(LOCAL_DICT));
