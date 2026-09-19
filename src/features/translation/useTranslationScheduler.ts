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
        // A persisted "translating" row can outlive its request after reload.
        // The queue's active/queued ID sets, not persisted status, own live work.
        if (sentence.translationStatus === 'not_translated' || sentence.translationStatus === 'translating') {
          translationQueue.enqueue(sentence);
        }
      }
    }
  }, [chapters, currentChapterIndex, chapterSentences, readingMode]);
}
