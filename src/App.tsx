import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell/AppShell';
import { LibraryPage } from './features/library/LibraryPage';
import { BookDetailPage } from './features/library/BookDetailPage';
import { ReaderPage } from './features/reader/ReaderPage';
import { VocabularyPage } from './features/vocabulary/VocabularyPage';
import { BookmarksPage } from './features/bookmarks/BookmarksPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { useVocabularyStore } from './stores/vocabularyStore';
import { useAppStore } from './stores/appStore';

export function App() {
  useEffect(() => {
    useVocabularyStore.getState().init();
    useAppStore.getState().initTheme();
  }, []);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/book/:bookId" element={<BookDetailPage />} />
        <Route path="/reader/:bookId" element={<ReaderPage />} />
        <Route path="/vocabulary" element={<VocabularyPage />} />
        <Route path="/bookmarks" element={<BookmarksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
