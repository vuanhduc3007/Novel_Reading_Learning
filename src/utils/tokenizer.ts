import { LOCAL_WORDS } from '../features/dictionary/dictionaryService';

export interface Token {
  text: string;
  isWord: boolean;
}

export function tokenize(text: string): Token[] {
  const result: Token[] = [];
  let i = 0;
  
  // Basic punctuation matcher
  const isPunctuation = (char: string) => /[。！？；…，、：""''（）《》\s\n]/.test(char);

  while (i < text.length) {
    const character = text.charAt(i);
    if (isPunctuation(character)) {
      result.push({ text: character, isWord: false });
      i++;
      continue;
    }

    let match = null;
    // Max match up to 4 characters
    for (let len = 4; len > 1; len--) {
      if (i + len <= text.length) {
        const sub = text.substring(i, i + len);
        if (LOCAL_WORDS.has(sub)) {
           match = sub;
           break;
        }
      }
    }

    if (match) {
      result.push({ text: match, isWord: true });
      i += match.length;
    } else {
      // fallback to single character
      result.push({ text: character, isWord: true });
      i++;
    }
  }
  return result;
}
