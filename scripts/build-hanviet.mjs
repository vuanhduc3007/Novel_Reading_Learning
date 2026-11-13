/**
 * Build src/data/hanviet.json: Sino-Vietnamese (Hán-Việt) readings per
 * character, the set of characters reliable enough to match on their own, and
 * a corpus-confirmed lexicon of frequent native-Vietnamese renderings.
 *
 * Usage:
 *   node scripts/build-hanviet.mjs <Unihan dir> [aligned-pairs.json]
 *
 * <Unihan dir> holds Unihan_Readings.txt and Unihan_Variants.txt from
 * https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip (Unicode license).
 * aligned-pairs.json is an optional array of [chinese, vietnamese] paragraph
 * pairs (for example produced by the reference aligner). It is used to
 *  - learn readings Unihan lacks (源 → nguyên, from 方源 ↔ "Phương Nguyên"),
 *  - measure which single characters and lexicon entries are precise enough.
 * Only aggregate statistics leave the corpus; no text is written out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [unihanDir, pairsPath] = process.argv.slice(2);
if (!unihanDir) {
  console.error('Usage: node scripts/build-hanviet.mjs <Unihan dir> [aligned-pairs.json]');
  process.exit(1);
}

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });
const matcher = await vite.ssrLoadModule('/src/features/immersion/wordMatcher.ts');
const { tokenize } = await vite.ssrLoadModule('/src/utils/tokenizer.ts');
const { syllableKey, viSyllables } = matcher;

const cp = code => String.fromCodePoint(parseInt(code.slice(2), 16));
const HAN = /^\p{Script=Han}+$/u;

// --- 1. Unihan readings + simplified/traditional propagation --------------
const readings = new Map(); // char -> string[] (ordered, NFC lower)
const addReading = (char, reading) => {
  const value = reading.normalize('NFC').toLowerCase();
  const list = readings.get(char) ?? [];
  if (!list.some(existing => syllableKey(existing) === syllableKey(value))) list.push(value);
  readings.set(char, list);
};
for (const line of fs.readFileSync(path.join(unihanDir, 'Unihan_Readings.txt'), 'utf8').split('\n')) {
  if (line.startsWith('#')) continue;
  const [code, field, value] = line.split('\t');
  if (field !== 'kVietnamese' || !value) continue;
  for (const reading of value.trim().split(/\s+/)) addReading(cp(code), reading);
}
const variants = new Map(); // char -> Set(variant chars)
for (const line of fs.readFileSync(path.join(unihanDir, 'Unihan_Variants.txt'), 'utf8').split('\n')) {
  if (line.startsWith('#')) continue;
  const [code, field, value] = line.split('\t');
  if ((field !== 'kTraditionalVariant' && field !== 'kSimplifiedVariant') || !value) continue;
  const char = cp(code);
  for (const other of value.trim().split(/\s+/)) {
    const variant = cp(other.split('<')[0]);
    if (variant === char) continue;
    if (!variants.has(char)) variants.set(char, new Set());
    variants.get(char).add(variant);
  }
}
for (const [char, others] of variants) {
  for (const other of others) for (const reading of readings.get(other) ?? []) addReading(char, reading);
}
const unihanCount = readings.size;

// --- 2. Corpus statistics ---------------------------------------------------
const lexiconSource = JSON.parse(fs.readFileSync(path.join(root, 'scripts/hanviet-lexicon.json'), 'utf8'));
delete lexiconSource._comment;
let singles = '';
const lexicon = {};
const report = [];

if (pairsPath) {
  const pairs = JSON.parse(fs.readFileSync(pairsPath, 'utf8'));
  const prepared = pairs.map(([zh, vi]) => {
    const syllables = viSyllables(vi);
    const words = tokenize(zh).filter(token => token.isWord && HAN.test(token.text)).map(token => token.text);
    return {
      words,
      chars: new Set(Array.from(zh).filter(char => HAN.test(char))),
      keys: syllables.map(syllable => syllable.key),
      forms: syllables.map(syllable => vi.slice(syllable.start, syllable.end).normalize('NFC').toLowerCase()),
    };
  });
  console.log(`corpus: ${prepared.length} pairs`);

  // 2a. Learn readings: a multi-character word whose other characters all
  // match consecutive syllables proposes the syllable at the remaining slot.
  for (let round = 1; round <= 3; round++) {
    const votes = new Map(); // char -> Map(form -> count)
    const voteWords = new Map(); // `${char}|${form}` -> Set(word)
    const keySets = new Map([...readings].map(([char, list]) => [char, new Set(list.map(syllableKey))]));
    for (const pair of prepared) {
      for (const word of new Set(pair.words)) {
        const chars = Array.from(word);
        if (chars.length < 2 || chars.length > 4) continue;
        for (let from = 0; from + chars.length <= pair.keys.length; from++) {
          let gap = -1;
          let ok = true;
          for (let k = 0; k < chars.length; k++) {
            if (keySets.get(chars[k])?.has(pair.keys[from + k])) continue;
            if (gap >= 0) { ok = false; break; }
            gap = k;
          }
          if (!ok || gap < 0) continue;
          // Every other character must be a known match; with two-character
          // words that is only one anchor, so require an exact neighbour.
          const char = chars[gap];
          const form = pair.forms[from + gap];
          if (!votes.has(char)) votes.set(char, new Map());
          votes.get(char).set(form, (votes.get(char).get(form) ?? 0) + 1);
          const voteKey = `${char}|${form}`;
          if (!voteWords.has(voteKey)) voteWords.set(voteKey, new Set());
          voteWords.get(voteKey).add(word);
        }
      }
    }
    let learned = 0;
    for (const [char, forms] of votes) {
      const total = [...forms.values()].reduce((sum, count) => sum + count, 0);
      for (const [form, count] of forms) {
        // A real reading recurs in several different words (源: 方源, 资源…);
        // a one-word coincidence (必定 ↔ "nhất định") does not.
        const wordTypes = voteWords.get(`${char}|${form}`)?.size ?? 0;
        if (count >= 8 && count / total >= 0.4 && wordTypes >= 2 && !readings.get(char)?.some(r => syllableKey(r) === syllableKey(form))) {
          addReading(char, form);
          learned++;
          report.push(`learn ${char} → ${form} (${count}/${total}, ${wordTypes} words)`);
        }
      }
    }
    console.log(`round ${round}: learned ${learned} readings`);
    if (learned === 0) break;
  }

  // 2b. Single characters: matched alone only when the syllable nearly always
  // means this character in aligned text (蛊 ↔ cổ yes; 各 ↔ "các" no).
  const keySets = new Map([...readings].map(([char, list]) => [char, new Set(list.map(syllableKey))]));
  const stats = new Map(); // char -> {withChar, both, withSyllable}
  const tokenChars = new Set();
  for (const pair of prepared) for (const word of pair.words) if (Array.from(word).length === 1) tokenChars.add(word);
  for (const char of tokenChars) if (keySets.has(char)) stats.set(char, { withChar: 0, both: 0, withSyllable: 0 });
  for (const pair of prepared) {
    const keys = new Set(pair.keys);
    const singleTokens = new Set(pair.words.filter(word => stats.has(word)));
    for (const [char, entry] of stats) {
      const present = [...keySets.get(char)].some(key => keys.has(key));
      const hasChar = pair.chars.has(char);
      if (singleTokens.has(char)) entry.withChar++;
      if (present) entry.withSyllable++;
      if (present && hasChar) entry.both++;
    }
  }
  const allowed = [];
  for (const [char, entry] of stats) {
    const precision = entry.withSyllable ? entry.both / entry.withSyllable : 0;
    const recall = entry.withChar ? Math.min(1, entry.both / entry.withChar) : 0;
    if (entry.withChar >= 15 && precision >= 0.6 && recall >= 0.5) allowed.push([char, entry.withChar]);
  }
  allowed.sort((a, b) => b[1] - a[1]);
  singles = allowed.map(([char]) => char).join('');
  console.log(`single characters allowed: ${allowed.length}`, singles.slice(0, 80));

  // 2c. Lexicon entries: keep renderings that co-occur reliably.
  for (const [word, value] of Object.entries(lexiconSource)) {
    const kept = [];
    for (const phrase of value.split('|')) {
      const phraseKeys = phrase.split(/\s+/).map(syllableKey);
      let withWord = 0;
      let both = 0;
      let withPhrase = 0;
      for (const pair of prepared) {
        const hasWord = pair.words.includes(word);
        let hasPhrase = false;
        for (let from = 0; from + phraseKeys.length <= pair.keys.length && !hasPhrase; from++) {
          hasPhrase = phraseKeys.every((key, k) => pair.keys[from + k] === key);
        }
        if (hasWord) withWord++;
        if (hasPhrase) withPhrase++;
        if (hasWord && hasPhrase) both++;
      }
      const precision = withPhrase ? both / withPhrase : 0;
      const recall = withWord ? both / withWord : 0;
      const keep = withWord >= 10 && recall >= 0.25 && precision >= 0.3;
      report.push(`${keep ? 'keep' : 'drop'} ${word} → ${phrase}: n=${withWord} recall=${recall.toFixed(2)} precision=${precision.toFixed(2)}`);
      if (keep) kept.push(phrase);
    }
    if (kept.length) lexicon[word] = kept.join('|');
  }
} else {
  console.warn('No corpus given: lexicon and single-character list are left empty.');
}

const output = {
  readings: Object.fromEntries([...readings].sort(([a], [b]) => a.localeCompare(b)).map(([char, list]) => [char, list.join('|')])),
  single: singles,
  lexicon,
};
const outPath = path.join(root, 'src/data/hanviet.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output));
fs.writeFileSync(path.join(path.dirname(pairsPath ?? outPath), 'hanviet-report.txt'), report.join('\n'));
console.log(`readings: ${unihanCount} from Unihan, ${readings.size} total; lexicon ${Object.keys(lexicon).length}; ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`);
await vite.close();
