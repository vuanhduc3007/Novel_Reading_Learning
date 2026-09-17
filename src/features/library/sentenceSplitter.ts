/**
 * Splits Chinese text into individual sentences.
 * Splits on Chinese sentence-ending punctuation: 。！？；…
 * Preserves the punctuation at the end of each sentence.
 * Filters out empty strings.
 */
export function splitChineseSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  
  // Split on Chinese sentence-ending punctuation, keeping the delimiter
  const parts = text.split(/((?:[。！？；]|……|…)+)/);
  const sentences: string[] = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // If this part is punctuation, append to previous sentence
    if (/^[。！？；…]+$/.test(trimmed) && sentences.length > 0) {
      sentences[sentences.length - 1] += trimmed;
    } else {
      sentences.push(trimmed);
    }
  }
  
  // If no Chinese punctuation found, try splitting by newlines
  if (sentences.length <= 1 && text.includes('\n')) {
    return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  }
  
  return sentences.filter(s => s.length > 0);
}
