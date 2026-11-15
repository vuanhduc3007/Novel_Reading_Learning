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
 * Every run of one to four adjacent Han characters, longest first. Used for
 * the preferred words only: the segmenter's boundaries differ between
 * browsers (Android Chrome may split 需要元石 as 需/要元/石), and a word the
 * reader is learning must be found on every device. Not used for all words:
 * spans across word boundaries (要元石 ↔ "cần nguyên thạch") would match.
 */
function characterSpans(chinese: string): ZhSpan[] {
  const spans = new Map<string, ZhSpan>();
  for (const run of chinese.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = Array.from(run);
    for (let start = 0; start < chars.length; start++) {
      for (let length = 1; length <= MAX_SPAN_CHARS && start + length <= chars.length; length++) {
        const part = chars.slice(start, start + length);
        const text = part.join('');
        if (!spans.has(text)) spans.set(text, { text, chars: part });
      }
    }
  }
  return [...spans.values()].sort((a, b) => b.chars.length - a.chars.length);
}

export interface MatchOptions {
  /**
   * Words matched first (e.g. the words shown to the reader), so a longer
   * span around them cannot take their place.
   */
  prefer?: (word: string) => boolean;
  /**
   * Words of two or more characters that stand on their own in the book
   * (古月, 方源, 族长, 修行): see isCompound.
   */
  isFreeWord?: (word: string) => boolean;
  /**
   * Pairings the reader made (担心 ↔ "lo lắng"), from userPairingIndex: used
   * like lexicon entries.
   */
  userLexicon?: (word: string) => string[][] | undefined;
}

/** Turn {word: "lo lắng|lo âu"} into a lookup of syllable keys for MatchOptions.userLexicon. */
export function userPairingIndex(pairings: Record<string, string>): (word: string) => string[][] | undefined {
  const map = new Map<string, string[][]>();
  for (const [word, value] of Object.entries(pairings)) {
    const phrases = value.split('|').map(phrase => viSyllables(phrase).map(syllable => syllable.key)).filter(keys => keys.length > 0);
    if (phrases.length) map.set(word, phrases);
  }
  return word => map.get(word);
}

/**
 * A four-character span made of two free words — 古月方源 (古月 + 方源),
 * 族长古月 (族长 + 古月), 蛊师修行 (蛊师 + 修行) — is two words written next to
 * each other, not a word. It is never a candidate: its parts are, so a
 * learner meets 古月 and 方源 wherever they occur, and the span cannot take
 * syllables from a real word next to it (古月博 in 族长古月博). Idioms
 * (天罗地网) and names (古月博) are kept: their pieces are not free words.
 */
export function isCompound(word: string, isFreeWord: (word: string) => boolean): boolean {
  const chars = Array.from(word);
  if (chars.length !== 4) return false;
  return isFreeWord(chars.slice(0, 2).join('')) && isFreeWord(chars.slice(2).join(''));
}

/**
 * Match Chinese words of `chinese` to spans of its translation `vietnamese`.
 * Results are non-overlapping on the Vietnamese side and sorted by position.
 */
export function matchWords(
  chinese: string,
  vietnamese: string,
  index: HanVietIndex,
  options: MatchOptions = {},
): WordMatch[] {
  const { prefer } = options;
  const lexiconOf = (word: string): string[][] | undefined => {
    const own = options.userLexicon?.(word);
    const base = index.lexiconPhrases(word);
    return own && base ? [...own, ...base] : own ?? base;
  };
  // Words being shown count as free words too (before the book's word
  // statistics exist, and for words just started).
  const free = (word: string) => Boolean(options.isFreeWord?.(word) || prefer?.(word));
  // Free words in this sentence, by character range. A candidate may contain
  // or sit inside one, but not start or end in the middle of one: 长古月博
  // (cutting 族长 in 族长古月博) is not a word.
  const sentenceChars = Array.from(chinese);
  const freeRanges: Array<[number, number]> = [];
  for (let start = 0; start < sentenceChars.length; start++) {
    for (let length = 2; length <= MAX_SPAN_CHARS && start + length <= sentenceChars.length; length++) {
      if (free(sentenceChars.slice(start, start + length).join(''))) freeRanges.push([start, start + length]);
    }
  }
  const cutsFreeWord = (from: number, to: number) => freeRanges.some(([a, b]) =>
    from < b && to > a && !(from <= a && to >= b) && !(a <= from && b >= to));
  const isWordSpan = (span: ZhSpan) => {
    if (isCompound(span.text, free)) return false;
    if (freeRanges.length === 0 || span.chars.length < 2) return true;
    // Rejected only if every occurrence cuts a free word.
    let clean = false;
    for (let at = 0; at + span.chars.length <= sentenceChars.length && !clean; at++) {
      if (span.chars.every((char, k) => sentenceChars[at + k] === char) && !cutsFreeWord(at, at + span.chars.length)) clean = true;
    }
    return clean;
  };
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

  // Where each Chinese word occurs, as a fraction of the sentence, so that a
  // word is given the Vietnamese span at about the same place: in
  // 人家…我都看在眼里 ↔ "Người ta … ta đều thấy", 我 takes the second "ta".
  const chineseLength = Array.from(chinese).length;
  const unclaimed = new Map<string, number[]>();
  const positionsOf = (text: string): number[] => {
    let list = unclaimed.get(text);
    if (!list) {
      list = [];
      const chars = Array.from(chinese);
      const word = Array.from(text);
      for (let at = 0; at + word.length <= chars.length; at++) {
        if (word.every((char, k) => chars[at + k] === char)) list.push((at + word.length / 2) / chineseLength);
      }
      unclaimed.set(text, list);
    }
    return list;
  };

  /** The free Vietnamese span for `text` closest to an unclaimed occurrence of it. */
  const findSequence = (text: string, keys: Array<Set<string>>): number => {
    const positions = positionsOf(text);
    let best = -1;
    let bestDistance = Infinity;
    let bestPosition = -1;
    outer: for (let from = 0; from + keys.length <= syllables.length; from++) {
      for (let k = 0; k < keys.length; k++) {
        if (used[from + k] || !keys[k]!.has(syllables[from + k]!.key)) continue outer;
      }
      const at = (from + keys.length / 2) / syllables.length;
      positions.forEach((position, slot) => {
        const distance = Math.abs(at - position);
        if (distance < bestDistance) {
          best = from;
          bestDistance = distance;
          bestPosition = slot;
        }
      });
      if (positions.length === 0 && best < 0) best = from;
    }
    if (bestPosition >= 0) positions.splice(bestPosition, 1);
    return best;
  };

  // A compound is replaced by its two words (the segmenter may keep
  // 古月方源 as one token, leaving no smaller span to match).
  const allSpans: ZhSpan[] = [];
  const seen = new Set<string>();
  const addSpan = (span: ZhSpan) => {
    if (seen.has(span.text)) return;
    seen.add(span.text);
    allSpans.push(span);
  };
  for (const span of chineseSpans(chinese)) {
    if (isWordSpan(span)) addSpan(span);
    else if (isCompound(span.text, free)) for (const chars of [span.chars.slice(0, 2), span.chars.slice(2)]) addSpan({ text: chars.join(''), chars });
  }
  allSpans.sort((x, y) => y.chars.length - x.chars.length);
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

  // Curated multi-character lexicon words (人家, 我们) come first, found by
  // characters on every device, so 人 alone cannot take the "người" of
  // 人家 ↔ "người ta" where a browser splits 人家 into 人/家.
  const lexiconWords = characterSpans(chinese).filter(span => span.chars.length > 1 && lexiconOf(span.text));

  // Preferred words next, all found by characters, so they do not depend on
  // where the browser's segmenter puts boundaries (Chrome on a desktop keeps
  // 我知道 as one token, Android splits 需要元石 as 需/要元/石). A single
  // character only counts where it is not part of a word: 我 in 我知道 (知道 is
  // the word) yes, 是 in 但是 no.
  const wordRanges: Array<[number, number]> = [...freeRanges];
  for (const span of lexiconWords) {
    for (let at = 0; at + span.chars.length <= sentenceChars.length; at++) {
      if (span.chars.every((char, k) => sentenceChars[at + k] === char)) wordRanges.push([at, at + span.chars.length]);
    }
  }
  const restrictToFreeStanding = (char: string) => {
    const positions: number[] = [];
    sentenceChars.forEach((current, at) => {
      if (current === char && !wordRanges.some(([a, b]) => a <= at && at < b)) positions.push((at + 0.5) / chineseLength);
    });
    unclaimed.set(char, positions);
    remaining.set(char, positions.length);
    return positions.length > 0;
  };
  const preferred = prefer
    ? [
        ...characterSpans(chinese).filter(span => span.chars.length > 1 && prefer(span.text) && isWordSpan(span)),
        ...characterSpans(chinese).filter(span => span.chars.length === 1 && prefer(span.text) && restrictToFreeStanding(span.text)),
      ]
    : [];
  const passes = prefer ? [lexiconWords, preferred, allSpans] : [lexiconWords, allSpans];
  for (const spans of passes) {
    // 1. Hán-Việt cognates, longest Chinese span first.
    for (const span of spans) {
      if (span.chars.length === 1 && !index.isSingleAllowed(span.text)) continue;
      const keys = span.chars.map(char => index.readingsOf(char));
      if (keys.some(set => !set)) continue;
      while (occurrences(span.text) > 0) {
        const from = findSequence(span.text, keys as Array<Set<string>>);
        if (from < 0) break;
        claim(span.text, from, span.chars.length, 'hanviet');
        consume(span.text);
      }
    }

    // 2. Native-word lexicon (你 ↔ ngươi).
    for (const span of spans) {
      const phrases = lexiconOf(span.text);
      if (!phrases) continue;
      for (const phrase of phrases) {
        while (occurrences(span.text) > 0) {
          const from = findSequence(span.text, phrase.map(key => new Set([key])));
          if (from < 0) break;
          claim(span.text, from, phrase.length, 'lexicon');
          consume(span.text);
        }
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

/**
 * Average number of multi-character Hán-Việt cognates (names, terms) shared
 * by aligned sentence pairs. Correct alignments of a novel score around 1–3,
 * pairs of unrelated sentences close to 0; used to reject false alignments.
 */
export function cognateAgreement(pairs: Array<{ zh: string; vi: string }>, index: HanVietIndex): number {
  if (pairs.length === 0) return 0;
  let shared = 0;
  for (const pair of pairs) {
    shared += matchWords(pair.zh, pair.vi, index)
      .filter(match => match.kind === 'hanviet' && Array.from(match.zh).length >= 2).length;
  }
  return shared / pairs.length;
}
