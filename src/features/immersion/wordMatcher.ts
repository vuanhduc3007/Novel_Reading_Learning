import { tokenize } from '../../utils/tokenizer';

/**
 * Finds which Vietnamese words in a translated sentence correspond to which
 * Chinese words of the source sentence, so the reader can show the Chinese
 * word in place of its Vietnamese counterpart ("diglot weave").
 *
 * Two kinds of evidence are used:
 *  - Hán-Việt cognates: 方源 ↔ "Phương Nguyên", 天罗地网 ↔ "thiên la địa võng".
 *    Every Chinese character's Sino-Vietnamese reading must match the
 *    Vietnamese syllable at the same position. This is very precise and is the
 *    biggest head start a Vietnamese learner has.
 *  - A small lexicon of frequent native words: 你 ↔ "ngươi", 杀 ↔ "giết".
 *    Accepted only when both sides occur in the aligned sentence pair.
 */

export interface HanVietData {
  /** char → readings separated by "|" (Vietnamese, NFC). */
  readings: Record<string, string>;
  /** Characters reliable enough to be matched on their own (single-char words). */
  single: string;
  /** Chinese word → Vietnamese renderings separated by "|". */
  lexicon: Record<string, string>;
}

export interface WordMatch {
  /** Chinese word as written in the source. */
  zh: string;
  /** Character offsets of the Vietnamese span in the translation. */
  viStart: number;
  viEnd: number;
  /** The Vietnamese span as written. */
  vi: string;
  kind: 'hanviet' | 'lexicon';
}

const TONE_MARKS: Record<string, string> = {
  '̀': '2', // huyền
  '́': '1', // sắc
  '̉': '3', // hỏi
  '̃': '4', // ngã
  '̣': '5', // nặng
};

/**
 * Tone-normalized key for one Vietnamese syllable. "hoà" and "hòa", "thuỷ"
 * and "thủy" get the same key regardless of where the tone mark was placed.
 */
export function syllableKey(syllable: string): string {
  let tone = '0';
  let base = '';
  for (const char of syllable.normalize('NFD').toLowerCase()) {
    const mark = TONE_MARKS[char];
    if (mark) tone = mark;
    else base += char;
  }
  return base.normalize('NFC') + tone;
}

export interface ViSyllable {
  key: string;
  start: number;
  end: number;
}

const VI_WORD = /[\p{L}\p{M}]+/gu;

export function viSyllables(text: string): ViSyllable[] {
  const result: ViSyllable[] = [];
  for (const match of text.matchAll(VI_WORD)) {
    result.push({ key: syllableKey(match[0]), start: match.index!, end: match.index! + match[0].length });
  }
  return result;
}

const HAN = /^\p{Script=Han}+$/u;
const MAX_SPAN_CHARS = 4;

export class HanVietIndex {
  private readonly readingKeys = new Map<string, Set<string>>();
  private readonly singles: Set<string>;
  private readonly lexicon = new Map<string, string[][]>();

  constructor(data: HanVietData) {
    for (const [char, value] of Object.entries(data.readings)) {
      this.readingKeys.set(char, new Set(value.split('|').map(syllableKey)));
    }
    this.singles = new Set(Array.from(data.single));
    for (const [word, value] of Object.entries(data.lexicon)) {
      this.lexicon.set(word, value.split('|').map(phrase => phrase.split(/\s+/).map(syllableKey)));
    }
  }

  readingsOf(char: string): Set<string> | undefined {
    return this.readingKeys.get(char);
  }

  /** First reading of every character, e.g. 天罗地网 → "thiên la địa võng". */
  hanViet(word: string, data: HanVietData): string {
    return Array.from(word, char => data.readings[char]?.split('|')[0] ?? '?').join(' ');
  }

  isSingleAllowed(char: string): boolean {
    return this.singles.has(char);
  }

  lexiconPhrases(word: string): string[][] | undefined {
    return this.lexicon.get(word);
  }
}

interface ZhSpan {
  text: string;
  chars: string[];
}

/**
 * Candidate Chinese spans, longest first: segmenter words plus runs of up to
 * four adjacent words (idioms are often split by the segmenter).
 */
function chineseSpans(chinese: string): ZhSpan[] {
  const tokens = tokenize(chinese);
  const spans = new Map<string, ZhSpan>();
  // Group consecutive Han tokens (punctuation breaks a run).
  const runs: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (token.isWord && HAN.test(token.text)) current.push(token.text);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  for (const run of runs) {
    for (let start = 0; start < run.length; start++) {
      let text = '';
      for (let end = start; end < run.length; end++) {
        text += run[end];
        const chars = Array.from(text);
        if (chars.length > MAX_SPAN_CHARS) break;
        if (!spans.has(text)) spans.set(text, { text, chars });
      }
    }
  }
  return [...spans.values()].sort((a, b) => b.chars.length - a.chars.length);
}

/**
 * Match Chinese words of `chinese` to spans of its translation `vietnamese`.
 * Results are non-overlapping on the Vietnamese side and sorted by position.
 */
export function matchWords(chinese: string, vietnamese: string, index: HanVietIndex): WordMatch[] {
  if (!chinese || !vietnamese) return [];
  const syllables = viSyllables(vietnamese);
  if (syllables.length === 0) return [];
  const used = new Array<boolean>(syllables.length).fill(false);
  const matches: WordMatch[] = [];

  const claim = (zh: string, from: number, length: number, kind: WordMatch['kind']) => {
    for (let k = 0; k < length; k++) used[from + k] = true;
    const viStart = syllables[from]!.start;
    const viEnd = syllables[from + length - 1]!.end;
    matches.push({ zh, viStart, viEnd, vi: vietnamese.slice(viStart, viEnd), kind });
  };

  const findSequence = (keys: Array<Set<string>>): number => {
    outer: for (let from = 0; from + keys.length <= syllables.length; from++) {
      for (let k = 0; k < keys.length; k++) {
        if (used[from + k] || !keys[k]!.has(syllables[from + k]!.key)) continue outer;
      }
      return from;
    }
    return -1;
  };

  const spans = chineseSpans(chinese);
  // A word may occur several times in the source sentence (你…你); it can then
  // claim as many Vietnamese spans.
  const remaining = new Map<string, number>();
  const occurrences = (text: string) => {
    let value = remaining.get(text);
    if (value === undefined) {
      value = chinese.split(text).length - 1;
      remaining.set(text, value);
    }
    return value;
  };
  // Claiming 方源 also uses up the 方 and 源 inside it.
  const consume = (text: string) => {
    const chars = Array.from(text);
    for (let start = 0; start < chars.length; start++) {
      for (let end = start + 1; end <= chars.length; end++) {
        const part = chars.slice(start, end).join('');
        remaining.set(part, occurrences(part) - 1);
      }
    }
  };

  // 1. Hán-Việt cognates, longest Chinese span first.
  for (const span of spans) {
    if (span.chars.length === 1 && !index.isSingleAllowed(span.text)) continue;
    const keys = span.chars.map(char => index.readingsOf(char));
    if (keys.some(set => !set)) continue;
    while (occurrences(span.text) > 0) {
      const from = findSequence(keys as Array<Set<string>>);
      if (from < 0) break;
      claim(span.text, from, span.chars.length, 'hanviet');
      consume(span.text);
    }
  }

  // 2. Native-word lexicon for whole segmenter words.
  for (const span of spans) {
    const phrases = index.lexiconPhrases(span.text);
    if (!phrases) continue;
    for (const phrase of phrases) {
      while (occurrences(span.text) > 0) {
        const from = findSequence(phrase.map(key => new Set([key])));
        if (from < 0) break;
        claim(span.text, from, phrase.length, 'lexicon');
        consume(span.text);
      }
    }
  }

  // A Chinese span is dropped if a longer span containing it already matched
  // (e.g. 方源 matched, so 方 on its own must not also claim "phương").
  return matches
    .filter(match => !matches.some(other => other !== match && other.zh.length > match.zh.length && other.zh.includes(match.zh)
      && other.viStart <= match.viStart && other.viEnd >= match.viEnd))
    .sort((a, b) => a.viStart - b.viStart);
}
