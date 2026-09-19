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
let hoverRequestId = 0;
let panelRequestId = 0;

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
    
    const requestId = ++hoverRequestId;
    hoverTimeout = setTimeout(async () => {
      // Show tooltip immediately with skeleton if we wanted, 
      // but for hover, spec says Local/Cache only, which is fast.
      try {
        const result = await lookupWord(word, false);
        if (requestId !== hoverRequestId) return;
        set({ hoveredWord: word, hoverPosition: position, tooltipResult: result });
      } catch {
        // Hover lookups are best-effort and must never affect reader rendering.
      }
    }, 150); // 150ms debounce
  },

  handleWordLeave: () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = null;
    hoverRequestId++;
    set({
      hoveredWord: null,
      hoverPosition: null,
      tooltipResult: null,
    });
  },

  handleWordClick: async (word) => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = null;
    hoverRequestId++;
    const requestId = ++panelRequestId;
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
      if (requestId !== panelRequestId || get().panelWord !== word || !get().isPanelOpen) return;
      
      if (result) {
        set({
          panelState: result.source === 'llm' ? 'complete_ai' : 'complete',
          panelResult: result,
        });
      } else {
        set({ panelState: 'unavailable', panelResult: null });
      }
    } catch (e) {
      if (requestId !== panelRequestId || get().panelWord !== word || !get().isPanelOpen) return;
      set({ panelState: 'error', panelResult: null });
    }
  },

  closePanel: () => {
    panelRequestId++;
    set({
      isPanelOpen: false,
      panelState: 'closed',
      // We keep the word/result so it doesn't flicker empty while sliding out
    });
  },
}));
