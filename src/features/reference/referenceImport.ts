import { db } from '../../db/database';
import { useReaderStore } from '../../stores/readerStore';
import { parseEpub, type ParsedBookData } from '../library/epubParser';
import { parseTxt } from '../library/txtParser';
import { splitVietnameseSentences } from '../library/sentenceSplitter';
import { yieldToMain } from '../../utils/yieldToMain';
import { loadHanViet } from '../immersion/hanVietData';
import { cognateAgreement } from '../immersion/wordMatcher';
import { keepBookFile, markDirty } from '../sync/localChanges';
import type { Chapter, Sentence } from '../../types';
import {
  StreamingAligner,
  alignUnits,
  isChineseHeading,
  isVietnameseHeading,
  normalizeBeads,
  stripChapterNoise,
  unitFeatures,
} from './aligner';

/**
 * Bump when alignment improves enough that existing imports should be redone.
 * 2: promotional lines removed, interrupted-import paragraph fix.
 * 3: front matter and unrelated chapters no longer receive text from elsewhere
 *    in the book (resync limits, lookahead and Hán-Việt content check).
 */
export const REFERENCE_VERSION = 3;

export interface ReferenceImportProgress {
  percent: number;
  detail: string;
}

export interface ReferenceImportSummary {
  title: string;
  matchedChapters: number;
  totalChapters: number;
  matchedSentences: number;
  totalSentences: number;
  /** True when the book predates paragraph tracking; alignment is sentence-based and less precise. */
  sentenceLevelOnly: boolean;
}

interface ZhUnit {
  text: string;
  sentenceIndices: number[];
}


async function parseReferenceFile(file: File, onProgress: (p: ReferenceImportProgress) => void): Promise<ParsedBookData> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (extension === 'epub') {
    return parseEpub(buffer, detail => onProgress({ percent: 5, detail }));
  }
  if (extension === 'txt' || extension === 'md') {
    return parseTxt(new TextDecoder('utf-8').decode(buffer), file.name);
  }
  throw new Error('Chỉ hỗ trợ bản dịch dạng EPUB hoặc TXT');
}

/** Units for one Chinese chapter: paragraphs when known, otherwise sentences. */
export function chineseUnits(chapter: Chapter, sentences: Sentence[], byParagraph: boolean): ZhUnit[] {
  const units: ZhUnit[] = [];
  if (byParagraph) {
    const byIndex = new Map<number, ZhUnit>();
    sentences.forEach((sentence, index) => {
      const key = sentence.paragraphIndex ?? index;
      let unit = byIndex.get(key);
      if (!unit) {
        unit = { text: '', sentenceIndices: [] };
        byIndex.set(key, unit);
        units.push(unit);
      }
      unit.text += sentence.chineseText;
      unit.sentenceIndices.push(index);
    });
  } else {
    sentences.forEach((sentence, index) => units.push({ text: sentence.chineseText, sentenceIndices: [index] }));
  }
  return units.filter(unit => !isChineseHeading(unit.text, chapter.title));
}

/**
 * Distribute the Vietnamese text of one aligned group over its Chinese
 * sentences. Equal counts map 1–1; otherwise a small sentence-level alignment
 * decides, and merged translations go on the last sentence of each group.
 */
export function distribute(zhSentences: string[], viText: string[], ratio: number): string[] {
  const result = zhSentences.map(() => '');
  if (zhSentences.length === 1) {
    result[0] = viText.join(' ');
    return result;
  }
  const viSentences = viText.flatMap(splitVietnameseSentences);
  if (viSentences.length === zhSentences.length) return viSentences;
  const aligned = alignUnits(zhSentences.map(unitFeatures), viSentences.map(unitFeatures), { ratio });
  for (const group of normalizeBeads(aligned.beads)) {
    const last = group.zh[group.zh.length - 1];
    if (last === undefined) continue;
    result[last] = group.vi.map(index => viSentences[index]!).join(' ');
  }
  return result;
}

/**
 * Paragraph numbers for a chapter of an older book (imported without them),
 * taken from the Vietnamese paragraph each sentence was aligned to. Sentences
 * without a match (headings) form their own paragraph.
 */
export function inferParagraphs(viParagraphOf: Array<number | undefined>): number[] {
  const result: number[] = [];
  let previousKey: string | null = null;
  let current = -1;
  viParagraphOf.forEach((paragraph, index) => {
    const key = paragraph === undefined ? `own-${index}` : `vi-${paragraph}`;
    if (key !== previousKey) current++;
    previousKey = key;
    result.push(current);
  });
  return result;
}

/**
 * Align a human Vietnamese translation (EPUB/TXT) with a book already in the
 * library and store it per sentence as `referenceText`. Chapters that cannot
 * be matched confidently keep using machine translation.
 */
export async function importReferenceTranslation(
  bookId: string,
  file: File,
  onProgress: (progress: ReferenceImportProgress) => void = () => undefined,
  options: { fromCloud?: boolean } = {},
): Promise<ReferenceImportSummary> {
  onProgress({ percent: 0, detail: 'Đang đọc file bản dịch…' });
  const parsed = await parseReferenceFile(file, onProgress);
  const viParagraphs = parsed.chapters
    .flatMap(chapter => stripChapterNoise(chapter.textContent
      .split(/\r?\n/)
      .map(paragraph => paragraph.trim())
      .filter(Boolean)))
    .filter(paragraph => !isVietnameseHeading(paragraph));
  if (viParagraphs.length === 0) throw new Error('Không tìm thấy nội dung trong file bản dịch');

  const chapters = await db.chapters.where('[bookId+index]').between([bookId, -Infinity], [bookId, Infinity]).toArray();
  if (chapters.length === 0) throw new Error('Không tìm thấy sách cần ghép bản dịch');
  const book = await db.books.get(bookId);
  const sample = await db.sentences.where('bookId').equals(bookId).first();
  // Paragraph numbers inferred by an earlier (possibly interrupted) run are
  // not source paragraphs: such books keep aligning sentence by sentence.
  const byParagraph = sample?.paragraphIndex !== undefined && !book?.paragraphsInferred;
  if (!byParagraph && !book?.paragraphsInferred) await db.books.update(bookId, { paragraphsInferred: true });

  // Older books have no paragraph numbers: align sentence streams instead,
  // and remember which Vietnamese paragraph each sentence came from so the
  // Chinese sentences can be grouped into the translator's paragraphs.
  const viUnits: string[] = [];
  const viUnitParagraph: number[] = [];
  viParagraphs.forEach((paragraph, paragraphIndex) => {
    for (const unit of byParagraph ? [paragraph] : splitVietnameseSentences(paragraph)) {
      viUnits.push(unit);
      viUnitParagraph.push(paragraphIndex);
    }
  });
  // Lengths propose alignments; shared names and Hán-Việt terms confirm them.
  const { index: hanViet } = await loadHanViet();
  const aligner = new StreamingAligner(viUnits, 3.6, pairs => cognateAgreement(pairs, hanViet));
  onProgress({ percent: 10, detail: `Đã đọc ${viParagraphs.length.toLocaleString('vi-VN')} đoạn bản dịch` });

  let matchedChapters = 0;
  let matchedSentences = 0;
  let totalSentences = 0;
  // Chapters are read slightly ahead: the next non-empty chapter confirms a
  // resync (see StreamingAligner.alignChapter).
  const loaded = new Map<number, { sentences: Sentence[]; units: ZhUnit[] }>();
  const loadChapter = async (index: number) => {
    let entry = loaded.get(index);
    if (!entry) {
      const chapter = chapters[index]!;
      const sentences = await db.sentences
        .where('[chapterId+index]')
        .between([chapter.id, -Infinity], [chapter.id, Infinity])
        .toArray();
      entry = { sentences, units: chineseUnits(chapter, sentences, byParagraph) };
      loaded.set(index, entry);
    }
    return entry;
  };
  const LOOKAHEAD_CHAPTERS = 3;

  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    const chapter = chapters[chapterIndex]!;
    const { sentences, units } = await loadChapter(chapterIndex);
    loaded.delete(chapterIndex);
    totalSentences += sentences.length;
    const references: Array<string | null> = sentences.map(() => null);
    const viParagraphOf: Array<number | undefined> = sentences.map(() => undefined);

    let lookahead: string[] | undefined;
    for (let next = chapterIndex + 1; next < Math.min(chapters.length, chapterIndex + 1 + LOOKAHEAD_CHAPTERS); next++) {
      const nextUnits = (await loadChapter(next)).units;
      if (nextUnits.length > 0) {
        lookahead = nextUnits.map(unit => unit.text);
        break;
      }
    }
    const result = units.length > 0 ? aligner.alignChapter(units.map(unit => unit.text), { lookahead }) : null;
    if (result?.accepted) {
      matchedChapters++;
      for (const group of normalizeBeads(result.beads)) {
        const sentenceIndices = group.zh.flatMap(unitIndex => units[unitIndex]!.sentenceIndices);
        const texts = distribute(
          sentenceIndices.map(index => sentences[index]!.chineseText),
          group.vi.map(index => viUnits[index]!),
          aligner.ratio,
        );
        const viParagraph = group.vi.length > 0 ? viUnitParagraph[group.vi[0]!] : undefined;
        sentenceIndices.forEach((sentenceIndex, position) => {
          references[sentenceIndex] = texts[position] ?? '';
          viParagraphOf[sentenceIndex] = viParagraph;
        });
        matchedSentences += sentenceIndices.length;
      }
    }

    const paragraphs = !byParagraph && result?.accepted ? inferParagraphs(viParagraphOf) : null;
    const changes = sentences
      .map((sentence, index) => {
        const update: Partial<Sentence> = {};
        const referenceText = references[index] ?? null;
        if ((sentence.referenceText ?? null) !== referenceText) update.referenceText = referenceText;
        if (paragraphs && sentence.paragraphIndex !== paragraphs[index]) update.paragraphIndex = paragraphs[index];
        return { key: sentence.id, changes: update };
      })
      .filter(change => Object.keys(change.changes).length > 0);
    if (changes.length > 0) await db.sentences.bulkUpdate(changes);

    const reader = useReaderStore.getState();
    if (reader.bookId === bookId && reader.chapterSentences[chapter.id]) {
      for (const change of changes) reader.updateSentenceInStore(chapter.id, change.key, change.changes);
    }

    if (chapterIndex % 20 === 0 || chapterIndex === chapters.length - 1) {
      onProgress({
        percent: 10 + Math.round(((chapterIndex + 1) / chapters.length) * 88),
        detail: `Đang ghép chương ${chapterIndex + 1}/${chapters.length} — khớp ${matchedChapters} chương`,
      });
      await yieldToMain();
    }
  }

  await db.books.update(bookId, { referenceTitle: parsed.title || file.name, referenceVersion: REFERENCE_VERSION });
  if (!options.fromCloud) {
    // A new translation file replaces the one in the account.
    await keepBookFile(bookId, 'reference', file);
    await db.books.update(bookId, { cloudReferencePath: null });
    markDirty('book', bookId);
  }
  onProgress({ percent: 100, detail: 'Hoàn tất' });
  return {
    title: parsed.title || file.name,
    matchedChapters,
    totalChapters: chapters.length,
    matchedSentences,
    totalSentences,
    sentenceLevelOnly: !byParagraph,
  };
}

/** Remove an imported reference translation; machine translation takes over again. */
export async function removeReferenceTranslation(bookId: string, options: { fromCloud?: boolean } = {}): Promise<void> {
  await db.bookFiles.delete([bookId, 'reference']);
  if (!options.fromCloud) {
    await db.books.update(bookId, { cloudReferencePath: null });
    markDirty('book', bookId);
  }
  await db.sentences.where('bookId').equals(bookId).modify(sentence => {
    delete sentence.referenceText;
  });
  await db.books.update(bookId, { referenceTitle: null });
  const reader = useReaderStore.getState();
  if (reader.bookId === bookId) {
    for (const [chapterId, list] of Object.entries(reader.chapterSentences)) {
      for (const sentence of list ?? []) reader.updateSentenceInStore(chapterId, sentence.id, { referenceText: null });
    }
  }
}
