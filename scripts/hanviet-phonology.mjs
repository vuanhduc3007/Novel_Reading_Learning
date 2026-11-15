/**
 * Telling learned Hán-Việt readings from Vietnamese translations.
 *
 * Readings learned from an aligned corpus (build-hanviet.mjs, step 2a) are of
 * two kinds that look the same in the data:
 *  - real Sino-Vietnamese readings the dictionary lacks: 年 niên, 时 thời,
 *    子 tử, 源 nguyên;
 *  - native Vietnamese words the translator used: 一 một, 是 là, 事 trên,
 *    要 cần, 母 phụ.
 * Used as readings, the second kind makes false cognates inside compounds
 * (事实 ↔ "trên thực", 酒虫 ↔ "cổ trùng").
 *
 * Sino-Vietnamese readings follow regular sound correspondences with Mandarin
 * (initial, final and tone: 年 nián → niên, 时 shí → thời); native words do
 * not (两 liǎng → hai). A small model of those correspondences is trained on
 * the dictionary readings and scores each learned reading. A reading scoring
 * below PHONOLOGY_THRESHOLD is not a Hán-Việt reading:
 *  - if the character is matched on its own (single list), the word becomes a
 *    lexicon rendering of it (是 ↔ "là" still matches 是 standing alone);
 *  - otherwise it is dropped.
 */
import { pinyin } from 'pinyin-pro';

export const PHONOLOGY_THRESHOLD = -4;

const TONE_MARKS = { '̀': 'huyền', '́': 'sắc', '̃': 'ngã', '̉': 'hỏi', '̣': 'nặng' };
const VI_INITIALS = ['ngh', 'ng', 'nh', 'ch', 'gh', 'gi', 'kh', 'ph', 'th', 'tr', 'qu', 'b', 'c', 'd', 'đ', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'x'];
const PY_INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

function vietnameseParts(reading) {
  let tone = 'ngang';
  for (const char of reading.normalize('NFD')) if (TONE_MARKS[char]) tone = TONE_MARKS[char];
  const plain = reading.normalize('NFD').replace(/[̣̀́̃̉]/g, '').normalize('NFC').toLowerCase();
  const initial = VI_INITIALS.find(prefix => plain.startsWith(prefix)) ?? '';
  return { initial, rhyme: plain.slice(initial.length), tone };
}

const pinyinCache = new Map();
function mandarinParts(char) {
  let parts = pinyinCache.get(char);
  if (!parts) {
    const syllable = pinyin(char, { toneType: 'none', type: 'array' })[0] ?? '';
    const numbered = String(pinyin(char, { toneType: 'num', type: 'array' })[0] ?? '');
    const initial = PY_INITIALS.find(prefix => syllable.startsWith(prefix)) ?? '';
    parts = { initial, final: syllable.slice(initial.length), tone: numbered.slice(-1) };
    pinyinCache.set(char, parts);
  }
  return parts;
}

/** Train on trusted (char, reading) pairs; returns score(char, reading), higher = more Sino-Vietnamese. */
export function trainPhonology(trustedPairs) {
  const counts = new Map();
  const add = key => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const [char, reading] of trustedPairs) {
    const zh = mandarinParts(char);
    const vi = vietnameseParts(reading);
    add(`i|${zh.initial}`); add(`i|${zh.initial}>${vi.initial}`);
    add(`f|${zh.final}`); add(`f|${zh.final}>${vi.rhyme}`);
    add(`t|${zh.tone}`); add(`t|${zh.tone}>${vi.tone}`);
  }
  const probability = (kind, from, to, outcomes) =>
    ((counts.get(`${kind}|${from}>${to}`) ?? 0) + 0.5) / ((counts.get(`${kind}|${from}`) ?? 0) + outcomes);
  return (char, reading) => {
    const zh = mandarinParts(char);
    const vi = vietnameseParts(reading);
    return Math.log10(probability('i', zh.initial, vi.initial, 20))
      + Math.log10(probability('f', zh.final, vi.rhyme, 100))
      + 0.5 * Math.log10(probability('t', zh.tone, vi.tone, 6));
  };
}

/**
 * Apply the rule to hanviet data in place.
 * @param data {readings: {char: "r1|r2"}, single: string, lexicon: {word: "a|b"}}
 * @param isLearned (char, reading) => boolean — not from the dictionary
 * @returns {{kept: string[][], toLexicon: string[][], dropped: string[][]}}
 */
export function filterLearnedReadings(data, isLearned) {
  const trusted = [];
  for (const [char, list] of Object.entries(data.readings)) {
    for (const reading of list.split('|')) if (!isLearned(char, reading)) trusted.push([char, reading]);
  }
  const score = trainPhonology(trusted);
  const singles = new Set(Array.from(data.single));
  const result = { kept: [], toLexicon: [], dropped: [] };
  for (const [char, list] of Object.entries(data.readings)) {
    const readings = list.split('|');
    const keep = [];
    for (const reading of readings) {
      if (!isLearned(char, reading) || score(char, reading) >= PHONOLOGY_THRESHOLD) {
        keep.push(reading);
        if (isLearned(char, reading)) result.kept.push([char, reading]);
      } else if (singles.has(char)) {
        const renderings = data.lexicon[char] ? data.lexicon[char].split('|') : [];
        if (!renderings.includes(reading)) renderings.push(reading);
        data.lexicon[char] = renderings.join('|');
        result.toLexicon.push([char, reading]);
      } else {
        result.dropped.push([char, reading]);
      }
    }
    if (keep.length) data.readings[char] = keep.join('|');
    else delete data.readings[char];
  }
  return result;
}
