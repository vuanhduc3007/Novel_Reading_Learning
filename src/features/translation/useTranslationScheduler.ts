import { useEffect } from 'react';
import { useReaderStore } from '../../stores/readerStore';
import { translationQueue } from './translationQueue';

export function useTranslationScheduler() {
  const chapters = useReaderStore(s => s.chapters);
  const currentChapterIndex = useReaderStore(s => s.currentChapterIndex);
  const chapterSentences = useReaderStore(s => s.chapterSentences);
  const readingMode = useReaderStore(s => s.readingMode);

  useEffect(() => {
    if (readingMode !== 'bilingual') return;

    // Scan mounted chapters (current ± 1)
    const start = Math.max(0, currentChapterIndex - 1);
    const end = Math.min(chapters.length - 1, currentChapterIndex + 1);

    for (let i = start; i <= end; i++) {
      const chapterId = chapters[i]?.id;
      if (!chapterId) continue;
      
      const sentences = chapterSentences[chapterId];
      if (!sentences) continue;

      for (const sentence of sentences) {
        if (sentence.translationStatus === 'not_translated') {
          translationQueue.enqueue(sentence);
        }
      }
    }
  }, [chapters, currentChapterIndex, chapterSentences, readingMode]);
}
