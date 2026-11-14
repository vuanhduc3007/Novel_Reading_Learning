import { db } from '../../db/database';
import { generateId } from '../../utils/id';
import { parseEpub } from './epubParser';
import { parseTxt } from './txtParser';
import { splitChineseParagraphs } from './sentenceSplitter';
import type { Book, Chapter, Sentence, SourceFormat, ImportStatus } from '../../types';
import type { ParsedBookData } from './epubParser';
import { translationQueue } from '../translation/translationQueue';
import { keepBookFile, markDirty } from '../sync/localChanges';

export type ImportStep = 'uploading' | 'parsing' | 'extracting' | 'processing' | 'ready';

export interface ImportProgressInfo {
  step: ImportStep;
  percent: number;
  detail?: string;
}

type ProgressCallback = (progress: ImportProgressInfo) => void;

function detectFormat(file: File): SourceFormat {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const formatMap: Record<string, SourceFormat> = {
    epub: 'epub',
    txt: 'txt',
    html: 'html',
    htm: 'html',
    md: 'md',
    markdown: 'md',
  };
  return formatMap[ext] || 'txt';
}

/** Sentence rows for one chapter, keeping each sentence's paragraph number. */
function toSentenceRecords(textContent: string, chapterId: string, bookId: string): Sentence[] {
  const records: Sentence[] = [];
  splitChineseParagraphs(textContent).forEach((paragraph, paragraphIndex) => {
    for (const chineseText of paragraph) {
      records.push({
        id: generateId(),
        chapterId,
        bookId,
        index: records.length,
        paragraphIndex,
        chineseText,
        vietnameseText: null,
        translationStatus: 'not_translated',
      });
    }
  });
  return records;
}

/**
 * Import a book file into the library.
 * Returns the bookId of the newly created book.
 * 
 * Pipeline: Uploading -> Parsing -> Extracting -> Processing -> Ready
 */
export interface ImportOptions {
  /** Use this id (a book rebuilt from the account keeps its id on every device). */
  bookId?: string;
  /** The book comes from the account: do not upload it back. */
  fromCloud?: boolean;
}

export async function importBook(
  file: File,
  onProgress?: ProgressCallback,
  options: ImportOptions = {},
): Promise<string> {
  const bookId = options.bookId ?? generateId();
  const format = detectFormat(file);

  // Keep the in-progress import outside IndexedDB. Only a complete readable
  // book is committed, so closing/reloading the tab cannot leave a permanent
  // zero-chapter record behind.
  const initialBook: Book = {
    id: bookId,
    title: file.name.replace(/\.[^.]+$/, ''),
    author: 'Processing...',
    coverUrl: null,
    sourceFormat: format,
    fileSizeBytes: file.size,
    importStatus: 'uploading',
    translationProgress: 0,
    readingProgress: 0,
    lastReadSentenceId: null,
    lastReadChapterIndex: 0,
    lastOpenedAt: null,
    createdAt: Date.now(),
    chapterCount: 0,
  };
  try {
    // STEP 1: Uploading (0-20%) — Read file into ArrayBuffer
    onProgress?.({ step: 'uploading', percent: 0, detail: 'Reading file...' });
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.({ step: 'uploading', percent: 20, detail: 'File loaded' });

    // STEP 2: Parsing (20-40%) — Parse file structure
    onProgress?.({ step: 'parsing', percent: 20, detail: 'Parsing file structure...' });
    let parsedData: ParsedBookData;

    if (format === 'epub') {
      parsedData = await parseEpub(arrayBuffer, (detail) => {
        onProgress?.({ step: 'parsing', percent: 30, detail });
      });
    } else {
      // TXT, HTML, MD — read as text
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      if (format === 'html') {
        parsedData = parseHtml(text, file.name);
      } else {
        parsedData = parseTxt(text, file.name, (detail) => {
          onProgress?.({ step: 'parsing', percent: 30, detail });
        });
      }
    }

    onProgress?.({ step: 'parsing', percent: 40, detail: `Found ${parsedData.chapters.length} chapters` });

    // STEP 3: Extracting chapters (40-70%) — Store chapters
    onProgress?.({ step: 'extracting', percent: 40, detail: 'Extracting chapters...' });
    const chapterRecords: Chapter[] = [];
    const allSentences: Sentence[] = [];

    for (let i = 0; i < parsedData.chapters.length; i++) {
      const ch = parsedData.chapters[i]!;
      const chapterId = generateId();
      const sentences = toSentenceRecords(ch.textContent, chapterId, bookId);

      chapterRecords.push({
        id: chapterId,
        bookId,
        index: i,
        title: ch.title,
        sentenceCount: sentences.length,
      });
      allSentences.push(...sentences);

      const percent = 40 + Math.round((i / parsedData.chapters.length) * 30);
      onProgress?.({
        step: 'extracting',
        percent,
        detail: `Extracted ${i + 1}/${parsedData.chapters.length} chapters (${allSentences.length} sentences)`,
      });
    }

    if (allSentences.length === 0) {
      throw new Error('Không tìm thấy câu có thể đọc trong file');
    }

    // STEP 4: Processing text (70-100%) — Bulk write to IndexedDB
    onProgress?.({ step: 'processing', percent: 70, detail: 'Saving to library...' });
    // Commit a complete readable book atomically. A failed batch cannot leave
    // orphan chapters/sentences behind a failed import record.
    await db.transaction('rw', [db.books, db.chapters, db.sentences], async () => {
      await db.books.add({
        ...initialBook,
        title: parsedData.title,
        author: parsedData.author,
        coverUrl: parsedData.coverDataUrl,
        importStatus: 'ready_to_read' as ImportStatus,
        chapterCount: chapterRecords.length,
      });
      await db.chapters.bulkAdd(chapterRecords);
      onProgress?.({ step: 'processing', percent: 80, detail: `Saved ${chapterRecords.length} chapters` });

      const BATCH_SIZE = 1000;
      for (let i = 0; i < allSentences.length; i += BATCH_SIZE) {
        const batch = allSentences.slice(i, i + BATCH_SIZE);
        await db.sentences.bulkAdd(batch);
        const percent = 80 + Math.round(((i + batch.length) / allSentences.length) * 18);
        onProgress?.({
          step: 'processing',
          percent: Math.min(percent, 98),
          detail: `Saved ${Math.min(i + batch.length, allSentences.length)}/${allSentences.length} sentences`,
        });
      }
    });

    if (!options.fromCloud) {
      // Keep the original so it can be uploaded to the account (now or after signing in).
      await keepBookFile(bookId, 'source', file);
      markDirty('book', bookId);
    }

    // STEP 5: Ready!
    onProgress?.({ step: 'ready', percent: 100, detail: 'Ready to read!' });

    return bookId;
  } catch (error) {
    throw error;
  }
}

/**
 * Delete a book and all its associated data.
 * Per spec §4.8:
 * - Chapters and sentences are deleted
 * - Bookmarks for this book are deleted
 * - Vocabulary items are kept but marked sourceBookAvailable: false
 * - Dictionary cache is not affected
 */
export async function deleteBook(bookId: string, options: { fromCloud?: boolean } = {}): Promise<void> {
  translationQueue.cancelAllForBook(bookId);
  await db.transaction('rw', [db.books, db.chapters, db.sentences, db.bookmarks, db.vocabularyItems, db.bookFiles, db.wordStats], async () => {
    await db.bookFiles.where('bookId').equals(bookId).delete();
    await db.wordStats.delete(bookId);
    // Delete sentences
    await db.sentences.where('bookId').equals(bookId).delete();
    // Delete chapters
    await db.chapters.where('bookId').equals(bookId).delete();
    // Delete bookmarks for this book
    await db.bookmarks.where('bookId').equals(bookId).delete();
    // Mark vocabulary items as source unavailable (don't delete them)
    await db.vocabularyItems.where('sourceBookId').equals(bookId).modify({
      sourceBookAvailable: false,
    });
    // Delete the book itself
    await db.books.delete(bookId);
  });
  // Deleting here deletes it from the account (and so from other devices).
  if (!options.fromCloud) markDirty('book', bookId);
}

/**
 * Replace a book with a new file.
 * Per spec §4.8:
 * - Resets reading progress, bookmarks, translation state
 * - Keeps vocabulary items
 * - Re-imports with new file content
 */
export async function replaceBook(
  bookId: string,
  file: File,
  onProgress?: ProgressCallback
): Promise<string> {
  // Parse and build the replacement before touching existing persisted data.
  // A malformed replacement must leave the user's readable book intact.
  const format = detectFormat(file);

  try {
    onProgress?.({ step: 'uploading', percent: 0, detail: 'Reading file...' });
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.({ step: 'uploading', percent: 20, detail: 'File loaded' });

    onProgress?.({ step: 'parsing', percent: 20, detail: 'Parsing file structure...' });
    let parsedData: ParsedBookData;

    if (format === 'epub') {
      parsedData = await parseEpub(arrayBuffer, (detail) => {
        onProgress?.({ step: 'parsing', percent: 30, detail });
      });
    } else {
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      if (format === 'html') {
        parsedData = parseHtml(text, file.name);
      } else {
        parsedData = parseTxt(text, file.name, (detail) => {
          onProgress?.({ step: 'parsing', percent: 30, detail });
        });
      }
    }

    onProgress?.({ step: 'parsing', percent: 40, detail: `Found ${parsedData.chapters.length} chapters` });

    onProgress?.({ step: 'extracting', percent: 40 });
    const chapterRecords: Chapter[] = [];
    const allSentences: Sentence[] = [];

    for (let i = 0; i < parsedData.chapters.length; i++) {
      const ch = parsedData.chapters[i]!;
      const chapterId = generateId();
      const sentences = toSentenceRecords(ch.textContent, chapterId, bookId);

      chapterRecords.push({
        id: chapterId, bookId, index: i,
        title: ch.title, sentenceCount: sentences.length,
      });
      allSentences.push(...sentences);

      const percent = 40 + Math.round((i / parsedData.chapters.length) * 30);
      onProgress?.({
        step: 'extracting', percent,
        detail: `Extracted ${i + 1}/${parsedData.chapters.length} chapters`,
      });
    }

    if (allSentences.length === 0) {
      throw new Error('Không tìm thấy câu có thể đọc trong file thay thế');
    }

    onProgress?.({ step: 'processing', percent: 70, detail: 'Saving to library...' });
    translationQueue.cancelAllForBook(bookId);
    await db.transaction('rw', [db.books, db.chapters, db.sentences, db.bookmarks], async () => {
      const existing = await db.books.get(bookId);
      if (!existing) throw new Error('Không tìm thấy sách cần thay thế');

      await db.sentences.where('bookId').equals(bookId).delete();
      await db.chapters.where('bookId').equals(bookId).delete();
      await db.bookmarks.where('bookId').equals(bookId).delete();
      await db.chapters.bulkAdd(chapterRecords);

      const BATCH_SIZE = 1000;
      for (let i = 0; i < allSentences.length; i += BATCH_SIZE) {
        const batch = allSentences.slice(i, i + BATCH_SIZE);
        await db.sentences.bulkAdd(batch);
        const percent = 80 + Math.round(((i + batch.length) / allSentences.length) * 18);
        onProgress?.({ step: 'processing', percent: Math.min(percent, 98) });
      }

      await db.books.update(bookId, {
        title: parsedData.title,
        author: parsedData.author,
        coverUrl: parsedData.coverDataUrl,
        sourceFormat: format,
        fileSizeBytes: file.size,
        importStatus: 'ready_to_read' as ImportStatus,
        chapterCount: chapterRecords.length,
        readingProgress: 0,
        translationProgress: 0,
        lastReadSentenceId: null,
        lastReadChapterIndex: 0,
        referenceTitle: null,
        paragraphsInferred: false,
        cloudSourcePath: null,
        cloudReferencePath: null,
        progressUpdatedAt: Date.now(),
      });
    });
    await db.bookFiles.where('bookId').equals(bookId).delete();
    await keepBookFile(bookId, 'source', file);
    markDirty('book', bookId);
    markDirty('progress', bookId);
    onProgress?.({ step: 'ready', percent: 100, detail: 'Ready to read!' });

    return bookId;
  } catch (error) {
    // Existing data is deliberately preserved when parsing or the atomic swap
    // fails; the modal surfaces the error without destroying the old book.
    throw error;
  }
}

/**
 * Parse HTML file as a single-chapter or multi-chapter book.
 */
function parseHtml(html: string, fileName: string): ParsedBookData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() || fileName.replace(/\.[^.]+$/, '');

  // Try to split by headings
  const headings = doc.querySelectorAll('h1, h2');
  if (headings.length > 1) {
    const chapters: { title: string; textContent: string }[] = [];
    headings.forEach((heading, i) => {
      let content = '';
      let sibling = heading.nextElementSibling;
      while (sibling && !['H1', 'H2'].includes(sibling.tagName)) {
        content += (sibling.textContent?.trim() || '') + '\n';
        sibling = sibling.nextElementSibling;
      }
      if (content.trim()) {
        chapters.push({ title: heading.textContent?.trim() || `Chapter ${i + 1}`, textContent: content.trim() });
      }
    });
    if (chapters.length > 0) {
      return { title, author: 'Unknown Author', coverDataUrl: null, chapters };
    }
  }

  // Single chapter
  const bodyText = doc.body?.textContent?.trim() || '';
  return {
    title,
    author: 'Unknown Author',
    coverDataUrl: null,
    chapters: [{ title: 'Full Text', textContent: bodyText }],
  };
}
