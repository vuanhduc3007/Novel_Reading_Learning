import { db } from '../../db/database';
import { useReaderStore } from '../../stores/readerStore';
import { parseEpub, type ParsedBookData } from '../library/epubParser';
import { parseTxt } from '../library/txtParser';
import { splitVietnameseSentences } from '../library/sentenceSplitter';
import type { Chapter, Sentence } from '../../types';
import {
  StreamingAligner,
  alignUnits,
  isChineseHeading,
  isVietnameseHeading,
  normalizeBeads,
  unitFeatures,
} from './aligner';

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

const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

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
 * Align a human Vietnamese translation (EPUB/TXT) with a book already in the
 * library and store it per sentence as `referenceText`. Chapters that cannot
 * be matched confidently keep using machine translation.
 */
export async function importReferenceTranslation(
  bookId: string,
  file: File,
  onProgress: (progress: ReferenceImportProgress) => void = () => undefined,
): Promise<ReferenceImportSummary> {
  onProgress({ percent: 0, detail: 'Đang đọc file bản dịch…' });
  const parsed = await parseReferenceFile(file, onProgress);
  const viParagraphs = parsed.chapters
    .flatMap(chapter => chapter.textContent.split(/\r?\n/))
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph && !isVietnameseHeading(paragraph));
  if (viParagraphs.length === 0) throw new Error('Không tìm thấy nội dung trong file bản dịch');

  const chapters = await db.chapters.where('[bookId+index]').between([bookId, -Infinity], [bookId, Infinity]).toArray();
  if (chapters.length === 0) throw new Error('Không tìm thấy sách cần ghép bản dịch');
  const sample = await db.sentences.where('bookId').equals(bookId).first();
  const byParagraph = sample?.paragraphIndex !== undefined;

  // Older books have no paragraph numbers: align sentence streams instead.
  const viUnits = byParagraph ? viParagraphs : viParagraphs.flatMap(splitVietnameseSentences);
  const aligner = new StreamingAligner(viUnits);
  onProgress({ percent: 10, detail: `Đã đọc ${viParagraphs.length.toLocaleString('vi-VN')} đoạn bản dịch` });

  let matchedChapters = 0;
  let matchedSentences = 0;
  let totalSentences = 0;
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    const chapter = chapters[chapterIndex]!;
    const sentences = await db.sentences
      .where('[chapterId+index]')
      .between([chapter.id, -Infinity], [chapter.id, Infinity])
      .toArray();
    totalSentences += sentences.length;
    const references: Array<string | null> = sentences.map(() => null);

    const units = chineseUnits(chapter, sentences, byParagraph);
    const result = units.length > 0 ? aligner.alignChapter(units.map(unit => unit.text)) : null;
    if (result?.accepted) {
      matchedChapters++;
      for (const group of normalizeBeads(result.beads)) {
        const sentenceIndices = group.zh.flatMap(unitIndex => units[unitIndex]!.sentenceIndices);
        const texts = distribute(
          sentenceIndices.map(index => sentences[index]!.chineseText),
          group.vi.map(index => viUnits[index]!),
          aligner.ratio,
        );
        sentenceIndices.forEach((sentenceIndex, position) => {
          references[sentenceIndex] = texts[position] ?? '';
        });
        matchedSentences += sentenceIndices.length;
      }
    }

    const changes = sentences
      .map((sentence, index) => ({ sentence, referenceText: references[index] ?? null }))
      .filter(({ sentence, referenceText }) => (sentence.referenceText ?? null) !== referenceText)
      .map(({ sentence, referenceText }) => ({ key: sentence.id, changes: { referenceText } }));
    if (changes.length > 0) await db.sentences.bulkUpdate(changes);

    const reader = useReaderStore.getState();
    if (reader.bookId === bookId && reader.chapterSentences[chapter.id]) {
      sentences.forEach((sentence, index) => {
        reader.updateSentenceInStore(chapter.id, sentence.id, { referenceText: references[index] ?? null });
      });
    }

    if (chapterIndex % 20 === 0 || chapterIndex === chapters.length - 1) {
      onProgress({
        percent: 10 + Math.round(((chapterIndex + 1) / chapters.length) * 88),
        detail: `Đang ghép chương ${chapterIndex + 1}/${chapters.length} — khớp ${matchedChapters} chương`,
      });
      await yieldToBrowser();
    }
  }

  await db.books.update(bookId, { referenceTitle: parsed.title || file.name });
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
export async function removeReferenceTranslation(bookId: string): Promise<void> {
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
