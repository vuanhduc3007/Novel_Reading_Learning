/**
 * Chinese text segmentation used by every importer.
 *
 * Paragraph boundaries (newlines) are always sentence boundaries: a chapter
 * title or a line without final punctuation must never be glued onto the next
 * paragraph. Inside a paragraph we split after sentence-final punctuation and
 * keep any trailing closing quotes/brackets with that sentence, so dialogue
 * such as “……痛快！” stays intact instead of leaking ” into the next sentence.
 */

const SENTENCE_RE = /[^。！？!?；…]*?(?:(?:[。！？!?；]|…+|\.{3,})+[”’」』）)》〕】"']*|[^。！？!?；…]+$)/gu;

/** Split one paragraph (no newlines) into sentences. */
export function splitParagraphSentences(paragraph: string): string[] {
  const text = paragraph.trim();
  if (!text) return [];
  const sentences: string[] = [];
  for (const match of text.matchAll(SENTENCE_RE)) {
    const piece = match[0].trim();
    if (!piece) continue;
    // A piece made only of punctuation/closers belongs to the previous sentence.
    if (sentences.length > 0 && /^[。！？!?；…”’」』）)》〕】"'\s.]+$/u.test(piece)) {
      sentences[sentences.length - 1] += piece;
    } else {
      sentences.push(piece);
    }
  }
  return sentences;
}

/** Split text into paragraphs, each a list of sentences. Empty paragraphs are dropped. */
export function splitChineseParagraphs(text: string): string[][] {
  if (!text || !text.trim()) return [];
  return text
    .split(/\r?\n/)
    .map(splitParagraphSentences)
    .filter(paragraph => paragraph.length > 0);
}

/**
 * Flat list of sentences (paragraph boundaries are still respected).
 */
export function splitChineseSentences(text: string): string[] {
  return splitChineseParagraphs(text).flat();
}

/**
 * Split one Vietnamese paragraph into sentences. Used to align a human
 * reference translation sentence-by-sentence inside matched paragraphs.
 */
export function splitVietnameseSentences(paragraph: string): string[] {
  const text = paragraph.trim();
  if (!text) return [];
  const pieces = text.match(/[^.!?…]*?(?:[.!?…]+[”"’')\]]*(?=\s|$)|$)/gu) ?? [text];
  const sentences: string[] = [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    if (sentences.length > 0 && /^[.!?…”"’')\]\s]+$/u.test(piece)) {
      sentences[sentences.length - 1] += piece;
    } else {
      sentences.push(piece);
    }
  }
  return sentences.length > 0 ? sentences : [text];
}
