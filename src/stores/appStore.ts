import { create } from 'zustand';
import type { ThemeMode } from '../types';

interface AppState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  initTheme: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'system',
  setTheme: (theme) => {
    set({ theme });
    localStorage.setItem('app-theme', theme);
    document.documentElement.setAttribute('data-theme', theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme);
  },
  initTheme: () => {
    const saved = (localStorage.getItem('app-theme') as ThemeMode) || 'system';
    set({ theme: saved });
    const actual = saved === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : saved;
    document.documentElement.setAttribute('data-theme', actual);
  }
}));
