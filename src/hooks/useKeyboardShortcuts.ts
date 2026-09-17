import { useEffect } from 'react';
import { useReaderStore } from '../stores/readerStore';
import { useDictionaryStore } from '../stores/dictionaryStore';

export function useKeyboardShortcuts() {
  const toggleSettings = useReaderStore(s => s.toggleSettings);
  const setTopBarVisible = useReaderStore(s => s.setTopBarVisible);
  const isTopBarVisible = useReaderStore(s => s.isTopBarVisible);
  const readingMode = useReaderStore(s => s.readingMode);
  const setReadingMode = useReaderStore(s => s.setReadingMode);
  const jumpToLocation = useReaderStore(s => s.jumpToLocation);
  const currentChapterIndex = useReaderStore(s => s.currentChapterIndex);
  const chapters = useReaderStore(s => s.chapters);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 's':
          toggleSettings();
          break;
        case 't':
          setTopBarVisible(!isTopBarVisible);
          break;
        case 'm':
          if (readingMode === 'bilingual') setReadingMode('chinese_only');
          else if (readingMode === 'chinese_only') setReadingMode('on_demand');
          else setReadingMode('bilingual');
          break;
        case 'arrowright':
          if (currentChapterIndex < chapters.length - 1) {
            jumpToLocation(currentChapterIndex + 1);
          }
          break;
        case 'arrowleft':
          if (currentChapterIndex > 0) {
            jumpToLocation(currentChapterIndex - 1);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSettings, isTopBarVisible, setTopBarVisible, readingMode, setReadingMode, currentChapterIndex, chapters.length, jumpToLocation]);
}
