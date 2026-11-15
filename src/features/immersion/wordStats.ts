import { db } from '../../db/database';
import type { BookWordStats, Sentence } from '../../types';
import { loadHanViet } from './hanVietData';
import { readingUnits } from './readingUnits';
import { yieldToMain } from '../../utils/yieldToMain';
import { isCompound, matchWords, type HanVietIndex } from './wordMatcher';

const MAX_WORDS = 3000;
/** Bump when the counting changes: stored statistics are then rebuilt. */
export const STATS_VERSION = 2;
/** A word of 2+ characters seen on its own this often is a free word (see isCompound). */
export const FREE_WORD_MIN = 5;

/** Free words of a book: multi-character words that occur on their own. */
export function freeWordsOf(words: Iterable<[string, number, ...unknown[]]>): Set<string> {
  const free = new Set<string>();
  for (const [word, count] of words) if (count >= FREE_WORD_MIN && Array.from(word).length >= 2) free.add(word);
  return free;
}

/** Accumulates word occurrences across chapters. */
export class WordCounter {
  private readonly counts = new Map<string, { count: number; renderings: Map<string, number> }>();

  addSentences(sentences: Sentence[], index: HanVietIndex): void {
    for (const unit of readingUnits(sentences)) {
      if (!unit.vietnamese) continue;
      for (const match of matchWords(unit.chinese, unit.vietnamese, index)) {
        let entry = this.counts.get(match.zh);
        if (!entry) {
          entry = { count: 0, renderings: new Map() };
          this.counts.set(match.zh, entry);
        }
        entry.count++;
        const rendering = match.vi.toLowerCase();
        entry.renderings.set(rendering, (entry.renderings.get(rendering) ?? 0) + 1);
      }
    }
  }

  toStats(bookId: string): BookWordStats {
    // A compound (古月方源 = 古月 + 方源) is two words: its occurrences count
    // for each part, and it is never offered as a word to learn.
    const free = freeWordsOf([...this.counts].map(([word, entry]): [string, number] => [word, entry.count]));
    for (const [word, entry] of [...this.counts]) {
      if (!isCompound(word, w => free.has(w))) continue;
      this.counts.delete(word);
      const chars = Array.from(word);
      const parts = [chars.slice(0, 2).join(''), chars.slice(2).join('')];
      for (const part of parts) {
        let target = this.counts.get(part);
        if (!target) {
          target = { count: 0, renderings: new Map() };
          this.counts.set(part, target);
        }
        target.count += entry.count;
      }
    }
    const words = [...this.counts]
      .map(([word, entry]): [string, number, string] => {
        const rendering = [...entry.renderings].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        return [word, entry.count, rendering];
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_WORDS);
    return { bookId, words, builtAt: Date.now(), version: STATS_VERSION };
  }
}

/** Count matchable words over every translated sentence of a book. */
export async function buildBookWordStats(bookId: string): Promise<BookWordStats> {
  const { index } = await loadHanViet();
  const counter = new WordCounter();
  const chapters = await db.chapters.where('[bookId+index]').between([bookId, -Infinity], [bookId, Infinity]).toArray();
  for (let position = 0; position < chapters.length; position++) {
    const chapter = chapters[position]!;
    const sentences = await db.sentences
      .where('[chapterId+index]')
      .between([chapter.id, -Infinity], [chapter.id, Infinity])
      .toArray();
    counter.addSentences(sentences, index);
    if (position % 5 === 4) await yieldToMain();
  }
  const stats = counter.toStats(bookId);
  await db.wordStats.put(stats);
  return stats;
}
