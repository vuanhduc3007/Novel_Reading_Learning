import { db } from '../../db/database';
import { generateId } from '../../utils/id';
import { parseEpub } from './epubParser';
import { parseTxt } from './txtParser';
import { splitChineseSentences } from './sentenceSplitter';
import type { Book, Chapter, Sentence, SourceFormat, ImportStatus } from '../../types';
import type { ParsedBookData } from './epubParser';
import { translationQueue } from '../translation/translationQueue';

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

/**
 * Import a book file into the library.
 * Returns the bookId of the newly created book.
 * 
 * Pipeline: Uploading -> Parsing -> Extracting -> Processing -> Ready
 */
export async function importBook(
  file: File,
  onProgress?: ProgressCallback
): Promise<string> {
  const bookId = generateId();
  const format = detectFormat(file);

  // Create initial book record in DB immediately (shows in Library as importing)
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
  await db.books.add(initialBook);

  try {
    // STEP 1: Uploading (0-20%) — Read file into ArrayBuffer
    onProgress?.({ step: 'uploading', percent: 0, detail: 'Reading file...' });
    const arrayBuffer = await file.arrayBuffer();
    await db.books.update(bookId, { importStatus: 'parsing' as ImportStatus });
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

    await db.books.update(bookId, {
      title: parsedData.title,
      author: parsedData.author,
      coverUrl: parsedData.coverDataUrl,
      importStatus: 'extracting' as ImportStatus,
    });
    onProgress?.({ step: 'parsing', percent: 40, detail: `Found ${parsedData.chapters.length} chapters` });

    // STEP 3: Extracting chapters (40-70%) — Store chapters
    onProgress?.({ step: 'extracting', percent: 40, detail: 'Extracting chapters...' });
    await db.books.update(bookId, { importStatus: 'extracting' as ImportStatus });

    const chapterRecords: Chapter[] = [];
    const allSentences: Sentence[] = [];

    for (let i = 0; i < parsedData.chapters.length; i++) {
      const ch = parsedData.chapters[i]!;
      const chapterId = generateId();
      const sentences = splitChineseSentences(ch.textContent);

      chapterRecords.push({
        id: chapterId,
        bookId,
        index: i,
        title: ch.title,
        sentenceCount: sentences.length,
      });

      for (let j = 0; j < sentences.length; j++) {
        allSentences.push({
          id: generateId(),
          chapterId,
          bookId,
          index: j,
          chineseText: sentences[j]!,
          vietnameseText: null,
          translationStatus: 'not_translated',
        });
      }

      const percent = 40 + Math.round((i / parsedData.chapters.length) * 30);
      onProgress?.({
        step: 'extracting',
        percent,
        detail: `Extracted ${i + 1}/${parsedData.chapters.length} chapters (${allSentences.length} sentences)`,
      });
    }

    // STEP 4: Processing text (70-100%) — Bulk write to IndexedDB
    onProgress?.({ step: 'processing', percent: 70, detail: 'Saving to library...' });
    await db.books.update(bookId, { importStatus: 'processing' as ImportStatus });

    // Bulk insert chapters
    await db.chapters.bulkAdd(chapterRecords);
    onProgress?.({ step: 'processing', percent: 80, detail: `Saved ${chapterRecords.length} chapters` });

    // Bulk insert sentences in batches (for very large books)
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

    // STEP 5: Ready!
    await db.books.update(bookId, {
      importStatus: 'ready_to_read' as ImportStatus,
      chapterCount: chapterRecords.length,
    });
    onProgress?.({ step: 'ready', percent: 100, detail: 'Ready to read!' });

    return bookId;
  } catch (error) {
    // Mark book as failed
    await db.books.update(bookId, {
      importStatus: 'failed' as ImportStatus,
    }).catch(() => {}); // Ignore if update fails too
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
export async function deleteBook(bookId: string): Promise<void> {
  translationQueue.cancelAllForBook(bookId);
  await db.transaction('rw', [db.books, db.chapters, db.sentences, db.bookmarks, db.vocabularyItems], async () => {
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
  // Delete old data (keep vocabulary)
  await db.transaction('rw', [db.chapters, db.sentences, db.bookmarks], async () => {
    await db.sentences.where('bookId').equals(bookId).delete();
    await db.chapters.where('bookId').equals(bookId).delete();
    await db.bookmarks.where('bookId').equals(bookId).delete();
  });

  // Reset book state
  await db.books.update(bookId, {
    importStatus: 'uploading' as ImportStatus,
    readingProgress: 0,
    translationProgress: 0,
    lastReadSentenceId: null,
    lastReadChapterIndex: 0,
  });

  // Re-run import pipeline, reusing the same bookId
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

    await db.books.update(bookId, {
      title: parsedData.title,
      author: parsedData.author,
      coverUrl: parsedData.coverDataUrl,
      sourceFormat: format,
      fileSizeBytes: file.size,
      importStatus: 'extracting' as ImportStatus,
    });
    onProgress?.({ step: 'parsing', percent: 40, detail: `Found ${parsedData.chapters.length} chapters` });

    onProgress?.({ step: 'extracting', percent: 40 });
    const chapterRecords: Chapter[] = [];
    const allSentences: Sentence[] = [];

    for (let i = 0; i < parsedData.chapters.length; i++) {
      const ch = parsedData.chapters[i]!;
      const chapterId = generateId();
      const sentences = splitChineseSentences(ch.textContent);

      chapterRecords.push({
        id: chapterId, bookId, index: i,
        title: ch.title, sentenceCount: sentences.length,
      });

      for (let j = 0; j < sentences.length; j++) {
        allSentences.push({
          id: generateId(), chapterId, bookId, index: j,
          chineseText: sentences[j]!, vietnameseText: null,
          translationStatus: 'not_translated',
        });
      }

      const percent = 40 + Math.round((i / parsedData.chapters.length) * 30);
      onProgress?.({
        step: 'extracting', percent,
        detail: `Extracted ${i + 1}/${parsedData.chapters.length} chapters`,
      });
    }

    onProgress?.({ step: 'processing', percent: 70, detail: 'Saving to library...' });
    await db.chapters.bulkAdd(chapterRecords);

    const BATCH_SIZE = 1000;
    for (let i = 0; i < allSentences.length; i += BATCH_SIZE) {
      const batch = allSentences.slice(i, i + BATCH_SIZE);
      await db.sentences.bulkAdd(batch);
      const percent = 80 + Math.round(((i + batch.length) / allSentences.length) * 18);
      onProgress?.({ step: 'processing', percent: Math.min(percent, 98) });
    }

    await db.books.update(bookId, {
      importStatus: 'ready_to_read' as ImportStatus,
      chapterCount: chapterRecords.length,
    });
    onProgress?.({ step: 'ready', percent: 100, detail: 'Ready to read!' });

    return bookId;
  } catch (error) {
    await db.books.update(bookId, { importStatus: 'failed' as ImportStatus }).catch(() => {});
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
