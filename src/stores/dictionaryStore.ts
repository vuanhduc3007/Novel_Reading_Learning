import { create } from 'zustand';
import { lookupWord } from '../features/dictionary/dictionaryService';
import type { DictionaryLookupResult, DictionaryPanelState } from '../types';

interface HoverPosition {
  x: number;
  y: number;
  height: number;
}

interface DictionaryStoreState {
  // Quick Tooltip State
  hoveredWord: string | null;
  hoverPosition: HoverPosition | null;
  tooltipResult: DictionaryLookupResult | null;
  
  // Full Panel State
  isPanelOpen: boolean;
  panelState: DictionaryPanelState;
  panelWord: string | null;
  panelResult: DictionaryLookupResult | null;

  // Actions
  handleWordHover: (word: string, position: HoverPosition) => void;
  handleWordLeave: () => void;
  handleWordClick: (word: string) => Promise<void>;
  closePanel: () => void;
}

// Timeout ref for debouncing hover
let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

export const useDictionaryStore = create<DictionaryStoreState>((set, get) => ({
  hoveredWord: null,
  hoverPosition: null,
  tooltipResult: null,
  
  isPanelOpen: false,
  panelState: 'closed',
  panelWord: null,
  panelResult: null,

  handleWordHover: (word, position) => {
    // Debounce hover to prevent spamming
    if (hoverTimeout) clearTimeout(hoverTimeout);
    
    hoverTimeout = setTimeout(async () => {
      // Show tooltip immediately with skeleton if we wanted, 
      // but for hover, spec says Local/Cache only, which is fast.
      const result = await lookupWord(word, false);
      
      set({
        hoveredWord: word,
        hoverPosition: position,
        tooltipResult: result,
      });
    }, 150); // 150ms debounce
  },

  handleWordLeave: () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    set({
      hoveredWord: null,
      hoverPosition: null,
      tooltipResult: null,
    });
  },

  handleWordClick: async (word) => {
    // Close tooltip, open panel
    set({
      hoveredWord: null,
      hoverPosition: null,
      tooltipResult: null,
      isPanelOpen: true,
      panelState: 'loading',
      panelWord: word,
      panelResult: null,
    });

    try {
      const result = await lookupWord(word, true);
      
      if (result) {
        set({
          panelState: result.source === 'llm' ? 'complete_ai' : 'complete',
          panelResult: result,
        });
      } else {
        set({ panelState: 'unavailable', panelResult: null });
      }
    } catch (e) {
      set({ panelState: 'error', panelResult: null });
    }
  },

  closePanel: () => {
    set({
      isPanelOpen: false,
      panelState: 'closed',
      // We keep the word/result so it doesn't flicker empty while sliding out
    });
  },
}));
