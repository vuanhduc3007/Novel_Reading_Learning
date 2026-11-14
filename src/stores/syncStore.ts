import { create } from 'zustand';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCloud } from '../features/sync/cloudApi';
import { SyncEngine, type AppliedChanges, type SyncHooks, type SyncProgress } from '../features/sync/syncEngine';
import { onLocalChange } from '../features/sync/localChanges';
import { deleteBook, importBook } from '../features/library/importEngine';
import { importReferenceTranslation, removeReferenceTranslation } from '../features/reference/referenceImport';
import { useImmersionStore } from './immersionStore';
import { useVocabularyStore } from './vocabularyStore';
import { useReaderStore } from './readerStore';
import { useAppStore } from './appStore';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** Account features exist only when the build has a Supabase project configured. */
export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// The Supabase library (~70 KB gzipped) is loaded only when accounts are configured.
let clientPromise: Promise<SupabaseClient> | null = null;
function getClient(): Promise<SupabaseClient> | null {
  if (!cloudConfigured) return null;
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, { auth: { persistSession: true, autoRefreshToken: true } }));
  return clientPromise;
}

const CHANGE_DELAY_MS = 5_000;
const PERIODIC_MS = 2 * 60_000;
const FOCUS_MIN_GAP_MS = 30_000;

export type SyncStatus = 'idle' | 'syncing' | 'error';

interface SyncState {
  configured: boolean;
  authReady: boolean;
  user: { id: string; email: string | null } | null;
  status: SyncStatus;
  progress: SyncProgress | null;
  lastSyncedAt: number | null;
  error: string | null;
  /** Local books whose original file is not kept and so cannot be uploaded. */
  missingFiles: string[];

  init: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<'signed_in' | 'confirm_email'>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  /** Wait (at most `timeoutMs`) for a sync, e.g. before opening a book. */
  syncBriefly: (timeoutMs: number) => Promise<void>;
}

const hooks: SyncHooks = {
  importSource: async (file, bookId, onProgress) => {
    await importBook(file, progress => onProgress(progress.detail ?? progress.step, progress.percent), { bookId, fromCloud: true });
  },
  importReference: async (bookId, file, onProgress) => {
    await importReferenceTranslation(bookId, file, progress => onProgress(progress.detail, progress.percent), { fromCloud: true });
  },
  removeReference: bookId => removeReferenceTranslation(bookId, { fromCloud: true }),
  deleteLocalBook: bookId => deleteBook(bookId, { fromCloud: true }),
  afterApply: (changed: AppliedChanges) => {
    if (changed.words) void useImmersionStore.getState().reloadProgress();
    if (changed.vocabulary) void useVocabularyStore.getState().init();
    if (changed.settings) {
      useReaderStore.getState().reloadSettings();
      useAppStore.getState().initTheme();
      useImmersionStore.getState().reloadSettings();
    }
    // Reading positions are applied to IndexedDB and used the next time a
    // book is opened; an open reader is never moved under the reader's eyes.
  },
};

let running: Promise<void> | null = null;
let runAgain = false;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export const useSyncStore = create<SyncState>((set, get) => ({
  configured: cloudConfigured,
  authReady: !cloudConfigured,
  user: null,
  status: 'idle',
  progress: null,
  lastSyncedAt: null,
  error: null,
  missingFiles: [],

  init: () => {
    const pending = getClient();
    if (!pending || started) return;
    started = true;
    void pending.then(supabase => {

    supabase.auth.onAuthStateChange((_event, session) => {
      const previous = get().user?.id ?? null;
      const user = session?.user ? { id: session.user.id, email: session.user.email ?? null } : null;
      set({ user, authReady: true });
      if (user && user.id !== previous) void get().syncNow();
    });
    void supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user ? { id: data.session.user.id, email: data.session.user.email ?? null } : null;
      set({ user, authReady: true });
      if (user) void get().syncNow();
    });
    }).catch(error => {
      console.error('Could not load the account library', error);
      set({ authReady: true, status: 'error', error: 'Không tải được thư viện tài khoản' });
    });

    onLocalChange(() => {
      if (!get().user) return;
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => void get().syncNow(), CHANGE_DELAY_MS);
    });
    document.addEventListener('visibilitychange', () => {
      if (!get().user) return;
      const last = get().lastSyncedAt ?? 0;
      // Leaving the tab: push now (the other device may be next). Coming back: pull.
      if (document.visibilityState === 'hidden' || Date.now() - last > FOCUS_MIN_GAP_MS) void get().syncNow();
    });
    setInterval(() => {
      if (get().user && document.visibilityState === 'visible') void get().syncNow();
    }, PERIODIC_MS);
  },

  signIn: async (email, password) => {
    const supabase = await getClient();
    if (!supabase) throw new Error('Chưa cấu hình tài khoản');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateAuthError(error.message));
  },

  signUp: async (email, password) => {
    const supabase = await getClient();
    if (!supabase) throw new Error('Chưa cấu hình tài khoản');
    // The confirmation link (if confirmation is on) brings the user back to this site.
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (error) throw new Error(translateAuthError(error.message));
    return data.session ? 'signed_in' : 'confirm_email';
  },

  signOut: async () => {
    const supabase = await getClient();
    if (!supabase) return;
    // Push what is pending first so nothing read on this device is lost.
    try { await get().syncNow(); } catch { /* best effort */ }
    await supabase.auth.signOut();
    set({ user: null, status: 'idle', progress: null, error: null, missingFiles: [] });
  },

  syncNow: async () => {
    const user = get().user;
    const pending = getClient();
    if (!pending || !user) return;
    const supabase = await pending;
    if (running) {
      runAgain = true;
      return running;
    }
    running = (async () => {
      do {
        runAgain = false;
        set({ status: 'syncing', error: null });
        try {
          const engine = new SyncEngine(new SupabaseCloud(supabase), user.id, hooks, progress => set({ progress }));
          const result = await engine.run();
          set({ status: 'idle', progress: null, lastSyncedAt: Date.now(), missingFiles: result.missingFiles });
        } catch (error) {
          console.error('Sync failed', error);
          set({ status: 'error', progress: null, error: error instanceof Error ? error.message : String(error) });
          runAgain = false;
        }
      } while (runAgain && get().user?.id === user.id);
    })().finally(() => { running = null; });
    return running;
  },

  syncBriefly: async (timeoutMs) => {
    if (!get().user) return;
    await Promise.race([get().syncNow(), new Promise<void>(resolve => setTimeout(resolve, timeoutMs))]);
  },
}));

function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Sai email hoặc mật khẩu';
  if (/email not confirmed/i.test(message)) return 'Email chưa được xác nhận — hãy mở thư xác nhận trong hộp thư';
  if (/already registered/i.test(message)) return 'Email này đã có tài khoản — hãy đăng nhập';
  if (/password should be at least/i.test(message)) return 'Mật khẩu cần ít nhất 6 ký tự';
  if (/rate limit/i.test(message)) return 'Thử quá nhiều lần, vui lòng đợi một lúc';
  return message;
}
