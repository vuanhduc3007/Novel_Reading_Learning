import { db } from '../../db/database';
import type { BookFile, SyncKind } from '../../types';

/**
 * Local side of account sync. Every user-made change records (kind, key) in
 * IndexedDB; the sync engine later sends the *current* local state of that
 * item, so many quick changes collapse into one upload. Changes are recorded
 * even when signed out so that signing in later uploads them.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markDirty(kind: SyncKind, key: string): void {
  db.syncDirty
    .put({ kind, key, at: Date.now() })
    .then(() => listeners.forEach(listener => listener()))
    .catch(error => console.error('Failed to record change for sync', error));
}

export function markManyDirty(kind: SyncKind, keys: string[]): void {
  if (keys.length === 0) return;
  const at = Date.now();
  db.syncDirty
    .bulkPut(keys.map(key => ({ kind, key, at })))
    .then(() => listeners.forEach(listener => listener()))
    .catch(error => console.error('Failed to record changes for sync', error));
}

/** localStorage keys that make up the synced settings. */
export const SETTINGS_KEYS = [
  'reader-mode',
  'reader-size',
  'reader-line-height',
  'reader-width',
  'reader-cn-font',
  'app-theme',
  'immersion-learning-size',
] as const;
export const SETTINGS_UPDATED_KEY = 'settings-updated-at';

/** Call after the user changes any setting in SETTINGS_KEYS. */
export function markSettingsChanged(): void {
  try {
    localStorage.setItem(SETTINGS_UPDATED_KEY, String(Date.now()));
  } catch {
    return;
  }
  markDirty('settings', 'settings');
}

/** Keep the original file of a book so it can be uploaded to the account. */
export async function keepBookFile(bookId: string, kind: BookFile['kind'], file: File): Promise<void> {
  await db.bookFiles.put({ bookId, kind, name: file.name, blob: file });
}
