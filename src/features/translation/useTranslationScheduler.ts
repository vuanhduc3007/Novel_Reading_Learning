import { useEffect } from 'react';
import { useReaderStore } from '../../stores/readerStore';
import { translationQueue } from './translationQueue';
import { warmUpTranslationApi } from './TranslationProvider';

export function useTranslationScheduler() {
  const chapters = useReaderStore(s => s.chapters);
  const currentChapterIndex = useReaderStore(s => s.currentChapterIndex);
  const chapterSentences = useReaderStore(s => s.chapterSentences);
  const readingMode = useReaderStore(s => s.readingMode);
  const bookId = useReaderStore(s => s.bookId);
  const currentSentenceId = useReaderStore(s => s.currentSentenceId);

  useEffect(() => {
    if (!bookId) return;
    // "Đọc chủ động" (on_demand) prefetches too: translations are hidden until
    // the reader asks, but must be instant when they do.
    if (readingMode === 'chinese_only') {
      translationQueue.stopForReader(bookId);
      return;
    }

    void warmUpTranslationApi();
    const currentChapter = chapters[currentChapterIndex];
    if (!currentChapter) return;
    const current = chapterSentences[currentChapter.id];
    if (!current) return;

    const currentSentenceIndex = currentSentenceId
      ? current.findIndex(sentence => sentence.id === currentSentenceId)
      : 0;
    const nearEnd = current.length === 0 || currentSentenceIndex >= Math.floor(current.length * 0.75);
    const nextChapter = chapters[currentChapterIndex + 1];
    const previousChapter = chapters[currentChapterIndex - 1];

    translationQueue.syncReaderWindow({
      bookId,
      currentChapterId: currentChapter.id,
      current,
      next: nextChapter && chapterSentences[nextChapter.id]
        ? { chapterId: nextChapter.id, sentences: chapterSentences[nextChapter.id]! }
        : undefined,
      previous: previousChapter && chapterSentences[previousChapter.id]
        ? { chapterId: previousChapter.id, sentences: chapterSentences[previousChapter.id]! }
        : undefined,
      nearEnd,
    });
  }, [bookId, chapters, currentChapterIndex, currentSentenceId, chapterSentences, readingMode]);
}
