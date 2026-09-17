import { create } from 'zustand';
import type { LibrarySortOption } from '../types';

export type ImportStep = 'uploading' | 'parsing' | 'extracting' | 'processing' | 'ready';

export interface ImportProgressInfo {
  step: ImportStep;
  percent: number;
  detail?: string;
}

interface LibraryUIState {
  searchQuery: string;
  sortOption: LibrarySortOption;
  isImportModalOpen: boolean;
  importMode: 'new' | 'replace';
  replaceBookId: string | null;
  isImporting: boolean;
  importProgress: ImportProgressInfo | null;
  importError: string | null;
  importedBookId: string | null;

  setSearchQuery: (q: string) => void;
  setSortOption: (o: LibrarySortOption) => void;
  openImportModal: (mode?: 'new' | 'replace', bookId?: string | null) => void;
  closeImportModal: () => void;
  setImportProgress: (p: ImportProgressInfo | null) => void;
  setImportError: (e: string | null) => void;
  setIsImporting: (v: boolean) => void;
  setImportedBookId: (id: string | null) => void;
  resetImportState: () => void;
}

export const useLibraryStore = create<LibraryUIState>((set) => ({
  searchQuery: '',
  sortOption: 'recent',
  isImportModalOpen: false,
  importMode: 'new',
  replaceBookId: null,
  isImporting: false,
  importProgress: null,
  importError: null,
  importedBookId: null,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setSortOption: (o) => set({ sortOption: o }),
  openImportModal: (mode = 'new', bookId = null) =>
    set({ isImportModalOpen: true, importMode: mode, replaceBookId: bookId, importError: null, importedBookId: null }),
  closeImportModal: () =>
    set({ isImportModalOpen: false, isImporting: false, importProgress: null, importError: null, importedBookId: null }),
  setImportProgress: (p) => set({ importProgress: p }),
  setImportError: (e) => set({ importError: e, isImporting: false }),
  setIsImporting: (v) => set({ isImporting: v }),
  setImportedBookId: (id) => set({ importedBookId: id, isImporting: false }),
  resetImportState: () =>
    set({ isImporting: false, importProgress: null, importError: null, importedBookId: null }),
}));
