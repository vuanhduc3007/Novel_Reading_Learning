/**
 * Apply the phonological rule (hanviet-phonology.mjs) to src/data/hanviet.json
 * as it is, without rebuilding it from a corpus.
 *
 * Usage: node scripts/filter-learned-readings.mjs <Unihan dir>
 *
 * A reading counts as learned when neither the character nor its simplified /
 * traditional variants have it in Unihan's kVietnamese field.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterLearnedReadings, PHONOLOGY_THRESHOLD } from './hanviet-phonology.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [unihanDir] = process.argv.slice(2);
if (!unihanDir) {
  console.error('Usage: node scripts/filter-learned-readings.mjs <Unihan dir>');
  process.exit(1);
}

const TONE_MARKS = { '̀': '2', '́': '1', '̉': '3', '̃': '4', '̣': '5' };
/** Same idea as syllableKey in wordMatcher.ts: tone placement does not matter. */
const syllableKey = syllable => {
  let tone = '0';
  let base = '';
  for (const char of syllable.normalize('NFD').toLowerCase()) {
    if (TONE_MARKS[char]) tone = TONE_MARKS[char];
    else base += char;
  }
  return base.normalize('NFC') + tone;
};
const fromCode = code => String.fromCodePoint(parseInt(code.slice(2), 16));

const dictionary = new Map(); // char -> Set(syllableKey)
for (const line of fs.readFileSync(path.join(unihanDir, 'Unihan_Readings.txt'), 'utf8').split('\n')) {
  const [code, field, value] = line.split('\t');
  if (field !== 'kVietnamese' || !value) continue;
  const char = fromCode(code);
  if (!dictionary.has(char)) dictionary.set(char, new Set());
  for (const reading of value.trim().split(/\s+/)) dictionary.get(char).add(syllableKey(reading));
}
const variants = new Map();
for (const line of fs.readFileSync(path.join(unihanDir, 'Unihan_Variants.txt'), 'utf8').split('\n')) {
  const [code, field, value] = line.split('\t');
  if ((field !== 'kTraditionalVariant' && field !== 'kSimplifiedVariant') || !value) continue;
  const char = fromCode(code);
  for (const other of value.trim().split(/\s+/)) {
    if (!variants.has(char)) variants.set(char, new Set());
    variants.get(char).add(fromCode(other.split('<')[0]));
  }
}
const inDictionary = (char, reading) => {
  const key = syllableKey(reading);
  if (dictionary.get(char)?.has(key)) return true;
  for (const variant of variants.get(char) ?? []) if (dictionary.get(variant)?.has(key)) return true;
  return false;
};

const dataPath = path.join(root, 'src/data/hanviet.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const result = filterLearnedReadings(data, (char, reading) => !inDictionary(char, reading));
fs.writeFileSync(dataPath, JSON.stringify(data));

const list = pairs => pairs.map(([char, reading]) => `${char} ${reading}`).join(', ');
console.log(`threshold ${PHONOLOGY_THRESHOLD}: kept ${result.kept.length} learned readings, moved ${result.toLexicon.length} to the lexicon, dropped ${result.dropped.length}`);
console.log(`to lexicon: ${list(result.toLexicon)}`);
console.log(`dropped: ${list(result.dropped)}`);
