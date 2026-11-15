import { db } from '../../db/database';
import { readingUnits } from './readingUnits';
import { matchWords, type HanVietIndex } from './wordMatcher';
import { yieldToMain } from '../../utils/yieldToMain';

/** How many chapters ahead new words are chosen from. */
export const UPCOMING_CHAPTERS = 10;

/**
 * How often each matchable word occurs in the chapters about to be read
 * (the current one and the next UPCOMING_CHAPTERS - 1). New words are chosen
 * from these, so a word just introduced keeps coming back right away.
 */
export async function countUpcomingWords(
  bookId: string,
  fromChapter: number,
  index: HanVietIndex,
  isFreeWord?: (word: string) => boolean,
): Promise<Map<string, number>> {
  const chapters = await db.chapters
    .where('[bookId+index]')
    .between([bookId, fromChapter], [bookId, fromChapter + UPCOMING_CHAPTERS - 1], true, true)
    .toArray();
  const counts = new Map<string, number>();
  for (const chapter of chapters) {
    const sentences = await db.sentences
      .where('[chapterId+index]')
      .between([chapter.id, -Infinity], [chapter.id, Infinity])
      .toArray();
    for (const unit of readingUnits(sentences)) {
      if (!unit.vietnamese) continue;
      for (const match of matchWords(unit.chinese, unit.vietnamese, index, { isFreeWord })) {
        counts.set(match.zh, (counts.get(match.zh) ?? 0) + 1);
      }
    }
    await yieldToMain();
  }
  return counts;
}
