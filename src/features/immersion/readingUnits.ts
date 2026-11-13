import type { Sentence } from '../../types';

/**
 * One displayable piece of Vietnamese text with the Chinese it translates.
 * Translators often merge several source sentences; those carry an empty
 * reference and their Chinese is attached to the sentence that holds the text.
 */
export interface ReadingUnit {
  sentence: Sentence;
  /** Chinese of this sentence plus preceding merged ones. */
  chinese: string;
  /** Vietnamese to show, or null while there is none yet. */
  vietnamese: string | null;
  source: 'reference' | 'machine' | null;
  /** True when this sentence's meaning is shown with a following sentence. */
  merged: boolean;
}

export function readingUnits(sentences: Sentence[]): ReadingUnit[] {
  const units: ReadingUnit[] = [];
  let pendingChinese = '';
  for (const sentence of sentences) {
    const reference = sentence.referenceText;
    if (reference === '') {
      pendingChinese += sentence.chineseText;
      units.push({ sentence, chinese: sentence.chineseText, vietnamese: null, source: 'reference', merged: true });
      continue;
    }
    const chinese = pendingChinese + sentence.chineseText;
    pendingChinese = '';
    if (reference !== undefined && reference !== null) {
      units.push({ sentence, chinese, vietnamese: reference, source: 'reference', merged: false });
    } else if (sentence.translationStatus === 'ready' && sentence.vietnameseText) {
      units.push({ sentence, chinese, vietnamese: sentence.vietnameseText, source: 'machine', merged: false });
    } else {
      units.push({ sentence, chinese, vietnamese: null, source: null, merged: false });
    }
  }
  return units;
}

/** Group consecutive units by paragraph; books without paragraph data get one unit per paragraph. */
export function groupParagraphs<T extends { sentence: Sentence }>(units: T[]): T[][] {
  const paragraphs: T[][] = [];
  let currentKey: number | undefined;
  for (const unit of units) {
    const key = unit.sentence.paragraphIndex;
    const last = paragraphs[paragraphs.length - 1];
    if (last && key !== undefined && key === currentKey) last.push(unit);
    else paragraphs.push([unit]);
    currentKey = key;
  }
  return paragraphs;
}
