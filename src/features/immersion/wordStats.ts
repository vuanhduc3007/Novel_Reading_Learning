import { db } from '../../db/database';
import type { BookWordStats, Sentence } from '../../types';
import { loadHanViet } from './hanVietData';
import { readingUnits } from './readingUnits';
import { yieldToMain } from '../../utils/yieldToMain';
import { matchWords, type HanVietIndex } from './wordMatcher';

const MAX_WORDS = 3000;

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
    const words = [...this.counts]
      .map(([word, entry]): [string, number, string] => {
        const rendering = [...entry.renderings].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        return [word, entry.count, rendering];
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_WORDS);
    return { bookId, words, builtAt: Date.now() };
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
