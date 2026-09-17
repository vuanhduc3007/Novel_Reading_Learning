import type { ParsedBookData, ParsedChapter } from './epubParser';

// Common Chinese chapter patterns
const CHAPTER_PATTERNS = [
  /^第[一二三四五六七八九十百千万零\d]+[章节回卷篇集部]/,  // 第X章, 第X节, etc.
  /^Chapter\s+\d+/i,                                      // Chapter N
  /^CHAPTER\s+/i,
  /^[\d]+[.、]\s*.+/,                                     // 1. Title or 1、Title
  /^【.+】$/,                                               // 【Chapter Title】
  /^「.+」$/,                                               // 「Chapter Title」
  /^卷[一二三四五六七八九十百千万零\d]+/,                   // 卷X
];

export function parseTxt(
  text: string, 
  fileName: string,
  onProgress?: (detail: string) => void
): ParsedBookData {
  const lines = text.split(/\r?\n/);
  const title = extractTitleFromFileName(fileName);

  // Try to detect chapters
  const chapterBreaks = detectChapterBreaks(lines);
  onProgress?.(`Detected ${chapterBreaks.length} chapter boundaries`);

  let chapters: ParsedChapter[];

  if (chapterBreaks.length > 1) {
    // Multi-chapter book
    chapters = [];
    for (let i = 0; i < chapterBreaks.length; i++) {
      const start = chapterBreaks[i]!;
      const end = i + 1 < chapterBreaks.length ? chapterBreaks[i + 1]! : lines.length;
      const chapterLines = lines.slice(start, end);
      const chapterTitle = chapterLines[0]?.trim() || `Chapter ${i + 1}`;
      const content = chapterLines.slice(1).join('\n').trim();
      if (content) {
        chapters.push({ title: chapterTitle, textContent: content });
        onProgress?.(`Extracted chapter ${chapters.length}: ${chapterTitle}`);
      }
    }
  } else {
    // Single chapter or no detected chapters — split large text by size
    const fullText = lines.join('\n').trim();
    if (fullText.length > 10000) {
      // Split into ~5000 char chunks at paragraph boundaries
      chapters = splitIntoChunks(fullText, 5000);
      onProgress?.(`Split into ${chapters.length} sections`);
    } else {
      chapters = [{ title: 'Full Text', textContent: fullText }];
    }
  }

  if (chapters.length === 0) {
    throw new Error('Could not extract any content from this file');
  }

  return {
    title,
    author: 'Unknown Author',
    coverDataUrl: null,
    chapters,
  };
}

function extractTitleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')  // Remove extension
    .replace(/[_-]/g, ' ')    // Replace separators
    .trim() || 'Untitled';
}

function detectChapterBreaks(lines: string[]): number[] {
  const breaks: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    for (const pattern of CHAPTER_PATTERNS) {
      if (pattern.test(line)) {
        breaks.push(i);
        break;
      }
    }
  }
  return breaks;
}

function splitIntoChunks(text: string, targetSize: number): ParsedChapter[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: ParsedChapter[] = [];
  let current = '';
  let chunkIndex = 1;

  for (const para of paragraphs) {
    if (current.length + para.length > targetSize && current.length > 0) {
      chunks.push({ title: `Section ${chunkIndex}`, textContent: current.trim() });
      chunkIndex++;
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) {
    chunks.push({ title: `Section ${chunkIndex}`, textContent: current.trim() });
  }
  return chunks;
}
