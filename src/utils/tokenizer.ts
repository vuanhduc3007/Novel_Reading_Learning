import { LOCAL_WORDS } from '../features/dictionary/localDictionary';

export interface Token {
  text: string;
  isWord: boolean;
}

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

// Intl handles ordinary vocabulary well, while this small override list keeps
// product/domain terms and proper names together when ICU would split them.
// Keep this deliberately narrow: an oversized longest-match dictionary creates
// incorrect boundaries in ambiguous prose.
const SEGMENTATION_WORDS = new Set([
  ...LOCAL_WORDS,
  '学习',
  '制作',
  '第一节',
  '方源',
  '古月方源',
  '春秋蝉',
  '魔道',
  '蛊师',
  '蛊真人',
  '蛊虫',
  '蛊仙',
  '酒虫',
  '月光蛊',
  '希望蛊',
]);

const LEXICON_LENGTHS = [...new Set([...SEGMENTATION_WORDS].map(word => Array.from(word).length))]
  .sort((left, right) => right - left);
const HAN_CHARACTER = /^\p{Script=Han}$/u;

let defaultSegmenter: SegmenterLike | null = null;
try {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale: string, options: { granularity: 'word' }) => SegmenterLike;
  }).Segmenter;
  if (typeof Segmenter === 'function') {
    defaultSegmenter = new Segmenter('zh', { granularity: 'word' });
  }
} catch {
  // Older browsers use the deterministic lexicon + single-character fallback.
}

function longestLexiconMatch(characters: string[], start: number): string | null {
  for (const length of LEXICON_LENGTHS) {
    if (start + length > characters.length) continue;
    const candidate = characters.slice(start, start + length).join('');
    if (SEGMENTATION_WORDS.has(candidate)) return candidate;
  }
  return null;
}

function segmentUnmatchedHan(text: string, segmenter: SegmenterLike | null): Token[] {
  if (!text) return [];
  if (!segmenter) return Array.from(text, character => ({ text: character, isWord: true }));

  const tokens: Token[] = [];
  for (const part of segmenter.segment(text)) {
    if (!part.segment) continue;
    // A Han run should normally be word-like. Preserve a clickable fallback if
    // an ICU implementation returns an unexpected non-word segment.
    if (part.isWordLike === false) {
      tokens.push(...Array.from(part.segment, character => ({ text: character, isWord: true })));
    } else {
      tokens.push({ text: part.segment, isWord: true });
    }
  }
  return tokens;
}

function segmentHanRun(text: string, segmenter: SegmenterLike | null): Token[] {
  const characters = Array.from(text);
  const result: Token[] = [];
  let cursor = 0;
  let unmatchedStart = 0;

  while (cursor < characters.length) {
    const match = longestLexiconMatch(characters, cursor);
    if (!match) {
      cursor++;
      continue;
    }

    result.push(...segmentUnmatchedHan(characters.slice(unmatchedStart, cursor).join(''), segmenter));
    result.push({ text: match, isWord: true });
    cursor += Array.from(match).length;
    unmatchedStart = cursor;
  }

  result.push(...segmentUnmatchedHan(characters.slice(unmatchedStart).join(''), segmenter));
  return result;
}

export function tokenize(text: string, segmenter: SegmenterLike | null = defaultSegmenter): Token[] {
  if (!text) return [];

  const result: Token[] = [];
  const characters = Array.from(text);
  let cursor = 0;

  while (cursor < characters.length) {
    const isHan = HAN_CHARACTER.test(characters[cursor]!);
    let end = cursor + 1;
    while (end < characters.length && HAN_CHARACTER.test(characters[end]!) === isHan) end++;

    const run = characters.slice(cursor, end).join('');
    if (isHan) {
      result.push(...segmentHanRun(run, segmenter));
    } else {
      // Keep whitespace, punctuation, Latin text, numbers and emoji byte-for-byte
      // without turning them into Chinese dictionary lookup targets.
      result.push({ text: run, isWord: false });
    }
    cursor = end;
  }

  return result;
}
