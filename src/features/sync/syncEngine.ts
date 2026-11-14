import { db } from '../../db/database';
import { generateId } from '../../utils/id';
import type { Book, SyncDirty, SyncKind } from '../../types';
import type { CloudApi, CloudRow, CloudTable } from './cloudApi';
import { SETTINGS_KEYS, SETTINGS_UPDATED_KEY } from './localChanges';

/**
 * One sync pass: pull what other devices wrote, push local changes, then
 * rebuild books that exist in the account but not on this device.
 *
 * Conflict rule: the write with the newer `updated_at` wins. Pulling first
 * means a local change only overwrites the cloud when it really is newer.
 */

export interface SyncProgress {
  phase: 'pull' | 'push' | 'download';
  detail: string;
  percent?: number;
}

/** Operations that rebuild or remove local books; injected (heavy imports, tests). */
export interface SyncHooks {
  importSource(file: File, bookId: string, onProgress: (detail: string, percent: number) => void): Promise<void>;
  importReference(bookId: string, file: File, onProgress: (detail: string, percent: number) => void): Promise<void>;
  removeReference(bookId: string): Promise<void>;
  deleteLocalBook(bookId: string): Promise<void>;
  /** Refresh in-memory stores after remote changes were written to IndexedDB. */
  afterApply(changed: AppliedChanges): void;
}

export interface AppliedChanges {
  books: boolean;
  words: boolean;
  vocabulary: boolean;
  bookmarks: boolean;
  settings: boolean;
  progressBookIds: string[];
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  downloadedBooks: string[];
  /** Local books that cannot be uploaded because the original file is not kept. */
  missingFiles: string[];
}

const TABLES: CloudTable[] = ['books', 'reading_progress', 'word_progress', 'vocabulary', 'bookmarks', 'settings'];

/**
 * Each upload gets a new name, so other devices notice a replaced file by its
 * path; older versions in the book's folder are removed after the upload.
 */
export function bookFolder(userId: string, bookId: string): string {
  return `${userId}/${bookId}`;
}

function versionedPath(userId: string, bookId: string, kind: 'source' | 'reference'): string {
  return `${bookFolder(userId, bookId)}/${kind}-${Date.now()}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? fallback) || fallback);
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

async function sentenceIndexOf(sentenceId: string | null | undefined): Promise<number> {
  if (!sentenceId) return 0;
  return (await db.sentences.get(sentenceId))?.index ?? 0;
}

/** Local sentence id for a (chapter, sentence) position, or null if absent. */
async function resolvePosition(bookId: string, chapterIndex: number, sentenceIndex: number) {
  const chapter = await db.chapters.where('[bookId+index]').equals([bookId, chapterIndex]).first();
  if (!chapter) return null;
  const sentence = await db.sentences.where('[chapterId+index]').equals([chapter.id, sentenceIndex]).first()
    ?? await db.sentences.where('[chapterId+index]').between([chapter.id, 0], [chapter.id, Infinity]).first();
  return { chapter, sentenceId: sentence?.id ?? null };
}

export class SyncEngine {
  constructor(
    private readonly api: CloudApi,
    private readonly userId: string,
    private readonly hooks: SyncHooks,
    private readonly report: (progress: SyncProgress) => void = () => undefined,
  ) {}

  private watermarkKey(table: CloudTable): string {
    return `sync-since:${this.userId}:${table}`;
  }

  async run(): Promise<SyncResult> {
    await this.markEverythingOnFirstSync();
    const changed: AppliedChanges = { books: false, words: false, vocabulary: false, bookmarks: false, settings: false, progressBookIds: [] };
    const toDownload = new Map<string, CloudRow>();

    this.report({ phase: 'pull', detail: 'Đang tải thay đổi từ tài khoản…' });
    let pulled = 0;
    for (const table of TABLES) {
      const key = this.watermarkKey(table);
      const rows = await this.api.pull(table, storage()?.getItem(key) ?? null);
      pulled += rows.length;
      await this.applyRows(table, rows, changed, toDownload);
      const last = rows[rows.length - 1]?.server_at;
      if (last) storage()?.setItem(key, String(last));
    }

    this.report({ phase: 'push', detail: 'Đang lưu thay đổi lên tài khoản…' });
    const { pushed, missingFiles } = await this.push();

    const downloadedBooks: string[] = [];
    for (const row of toDownload.values()) {
      if (await this.downloadBook(row, changed)) downloadedBooks.push(String(row.id));
    }

    if (this.reconciled) {
      changed.words ||= this.reconciled.words;
      changed.settings ||= this.reconciled.settings;
      changed.progressBookIds.push(...this.reconciled.progressBookIds);
    }
    this.hooks.afterApply(changed);
    return { pushed, pulled, downloadedBooks, missingFiles };
  }

  /** First sync of this account on this device: everything local is new to the cloud. */
  private async markEverythingOnFirstSync(): Promise<void> {
    const key = `sync-initialized:${this.userId}`;
    if (storage()?.getItem(key)) return;
    const at = Date.now();
    const entries: SyncDirty[] = [];
    for (const book of await db.books.toArray()) {
      entries.push({ kind: 'book', key: book.id, at }, { kind: 'progress', key: book.id, at });
    }
    for (const word of await db.wordProgress.toCollection().primaryKeys()) entries.push({ kind: 'word', key: String(word), at });
    for (const item of await db.vocabularyItems.toArray()) entries.push({ kind: 'vocabulary', key: item.word, at });
    for (const bookmark of await db.bookmarks.toArray()) entries.push({ kind: 'bookmark', key: bookmark.id, at });
    entries.push({ kind: 'settings', key: 'settings', at });
    await db.syncDirty.bulkPut(entries);
    storage()?.setItem(key, String(at));
  }

  // --- Pull --------------------------------------------------------------

  private async applyRows(table: CloudTable, rows: CloudRow[], changed: AppliedChanges, toDownload: Map<string, CloudRow>) {
    for (const row of rows) {
      switch (table) {
        case 'books': await this.applyBook(row, changed, toDownload); break;
        case 'reading_progress': await this.applyProgress(row, changed); break;
        case 'word_progress': await this.applyWord(row, changed); break;
        case 'vocabulary': await this.applyVocabulary(row, changed); break;
        case 'bookmarks': await this.applyBookmark(row, changed); break;
        case 'settings': this.applySettings(row, changed); break;
      }
    }
  }

  /** Time of a local change not yet pushed; it wins over older remote rows. */
  private async pendingAt(kind: SyncKind, key: string): Promise<number> {
    return (await db.syncDirty.get([kind, key]))?.at ?? 0;
  }

  private async applyBook(row: CloudRow, changed: AppliedChanges, toDownload: Map<string, CloudRow>) {
    const id = String(row.id);
    // e.g. the book was just deleted here and that is not pushed yet.
    if (await this.pendingAt('book', id) >= num(row.updated_at)) return;
    const local = await db.books.get(id);
    if (row.deleted) {
      toDownload.delete(id);
      if (local) {
        await this.hooks.deleteLocalBook(id);
        changed.books = true;
      }
      return;
    }
    if (!local) {
      if (row.source_path) toDownload.set(id, row);
      return;
    }
    const remoteReference = str(row.reference_path);
    if (remoteReference && remoteReference !== local.cloudReferencePath) {
      // Another device attached (or re-did) the human translation.
      toDownload.set(id, row);
    } else if (!remoteReference && local.cloudReferencePath && local.referenceTitle) {
      await this.hooks.removeReference(id);
      await db.books.update(id, { cloudReferencePath: null });
      changed.books = true;
    }
    if (str(row.source_path) && !local.cloudSourcePath) await db.books.update(id, { cloudSourcePath: str(row.source_path) });
  }

  private async applyProgress(row: CloudRow, changed: AppliedChanges, force = false) {
    const bookId = String(row.book_id);
    const book = await db.books.get(bookId);
    if (!book) return; // applied after the book is downloaded
    const updatedAt = num(row.updated_at);
    if (!force && updatedAt <= (book.progressUpdatedAt ?? 0)) return;
    const position = await resolvePosition(bookId, num(row.chapter_index), num(row.sentence_index));
    if (!position) return;
    await db.books.update(bookId, {
      lastReadChapterIndex: position.chapter.index,
      lastReadSentenceId: position.sentenceId,
      readingProgress: num(row.progress),
      progressUpdatedAt: updatedAt,
    });
    changed.progressBookIds.push(bookId);
  }

  private async applyWord(row: CloudRow, changed: AppliedChanges) {
    const word = String(row.word);
    const local = await db.wordProgress.get(word);
    const updatedAt = num(row.updated_at);
    if (local && local.updatedAt >= updatedAt) return;
    const status = row.status === 'known' || row.status === 'ignored' ? row.status : 'learning';
    await db.wordProgress.put({ word, status, exposures: num(row.exposures), updatedAt });
    changed.words = true;
  }

  private async applyVocabulary(row: CloudRow, changed: AppliedChanges) {
    const word = String(row.word);
    if (await this.pendingAt('vocabulary', word) >= num(row.updated_at)) return;
    const local = await db.vocabularyItems.where('word').equals(word).first();
    if (row.deleted) {
      if (local && local.addedAt <= num(row.updated_at)) {
        await db.vocabularyItems.delete(local.id);
        changed.vocabulary = true;
      }
      return;
    }
    if (local) return;
    const sourceBookId = str(row.source_book_id) ?? '';
    await db.vocabularyItems.add({
      id: generateId(),
      word,
      pinyin: str(row.pinyin) ?? '',
      meaning: str(row.meaning) ?? '',
      partOfSpeech: str(row.part_of_speech),
      sourceBookId,
      sourceBookTitle: str(row.source_book_title) ?? '',
      sourceBookAvailable: Boolean(sourceBookId && await db.books.get(sourceBookId)),
      sourceSentenceId: null,
      isKnown: true,
      addedAt: num(row.added_at, Date.now()),
    });
    changed.vocabulary = true;
  }

  private async applyBookmark(row: CloudRow, changed: AppliedChanges) {
    const id = String(row.id);
    if (await this.pendingAt('bookmark', id) >= num(row.updated_at)) return;
    if (row.deleted) {
      if (await db.bookmarks.get(id)) {
        await db.bookmarks.delete(id);
        changed.bookmarks = true;
      }
      return;
    }
    const bookId = String(row.book_id);
    if (!(await db.books.get(bookId))) return; // applied after the book is downloaded
    const position = await resolvePosition(bookId, num(row.chapter_index), num(row.sentence_index));
    if (!position?.sentenceId) return;
    await db.bookmarks.put({
      id,
      bookId,
      bookTitle: str(row.book_title) ?? '',
      chapterId: position.chapter.id,
      chapterTitle: str(row.chapter_title) ?? position.chapter.title,
      chapterIndex: position.chapter.index,
      sentenceId: position.sentenceId,
      previewText: str(row.preview_text) ?? '',
      createdAt: num(row.created_at, Date.now()),
    });
    changed.bookmarks = true;
  }

  private applySettings(row: CloudRow, changed: AppliedChanges) {
    const local = storage();
    if (!local) return;
    const updatedAt = num(row.updated_at);
    if (updatedAt <= num(local.getItem(SETTINGS_UPDATED_KEY))) return;
    const data = (row.data ?? {}) as Record<string, unknown>;
    for (const key of SETTINGS_KEYS) {
      const value = data[key];
      if (typeof value === 'string') local.setItem(key, value);
    }
    local.setItem(SETTINGS_UPDATED_KEY, String(updatedAt));
    changed.settings = true;
  }

  // --- Push --------------------------------------------------------------

  private async push(): Promise<{ pushed: number; missingFiles: string[] }> {
    const dirty = await db.syncDirty.orderBy('at').toArray();
    const rows = new Map<CloudTable, CloudRow[]>();
    const done: SyncDirty[] = [];
    const missingFiles: string[] = [];
    const add = (table: CloudTable, row: CloudRow) => {
      const list = rows.get(table) ?? [];
      list.push(row);
      rows.set(table, list);
    };

    for (const entry of dirty) {
      const handled = await this.prepare(entry, add, missingFiles);
      if (handled) done.push(entry);
    }
    for (const [table, list] of rows) await this.api.upsert(table, list);

    // Remove only entries that did not change again while we were uploading.
    await db.transaction('rw', db.syncDirty, async () => {
      for (const entry of done) {
        const current = await db.syncDirty.get([entry.kind, entry.key]);
        if (current && current.at === entry.at) await db.syncDirty.delete([entry.kind, entry.key]);
      }
    });
    await this.reconcile(rows);
    return { pushed: done.length, missingFiles };
  }

  /**
   * The server keeps the newer of two writes. Where ours lost (another device
   * wrote something newer that we had already pulled past), take theirs.
   */
  private async reconcile(pushed: Map<CloudTable, CloudRow[]>): Promise<void> {
    const changed: AppliedChanges = { books: false, words: false, vocabulary: false, bookmarks: false, settings: false, progressBookIds: [] };
    const progressIds = (pushed.get('reading_progress') ?? []).map(row => String(row.book_id));
    if (progressIds.length > 0) {
      for (const row of await this.api.selectIn('reading_progress', 'book_id', progressIds)) await this.applyProgress(row, changed);
    }
    const words = (pushed.get('word_progress') ?? []).map(row => String(row.word));
    if (words.length > 0) {
      for (const row of await this.api.selectIn('word_progress', 'word', words)) await this.applyWord(row, changed);
    }
    if (pushed.has('settings')) {
      for (const row of await this.api.pull('settings', null)) this.applySettings(row, changed);
    }
    this.reconciled = changed;
  }

  private reconciled: AppliedChanges | null = null;

  /** Build the cloud row for one changed item. Returns false to retry later. */
  private async prepare(entry: SyncDirty, add: (table: CloudTable, row: CloudRow) => void, missingFiles: string[]): Promise<boolean> {
    const kind: SyncKind = entry.kind;
    const now = Date.now();
    switch (kind) {
      case 'book': {
        const book = await db.books.get(entry.key);
        if (!book) {
          add('books', { id: entry.key, title: '', source_format: '', created_at: 0, updated_at: now, deleted: true });
          const folder = bookFolder(this.userId, entry.key);
          await this.api.list(folder).then(paths => this.api.remove(paths)).catch(() => undefined);
          return true;
        }
        if (book.importStatus !== 'ready_to_read') return false;
        const uploaded = await this.uploadBookFiles(book);
        if (!uploaded) {
          missingFiles.push(book.id);
          return false;
        }
        const fresh = (await db.books.get(book.id))!;
        const files = await db.bookFiles.where('bookId').equals(book.id).toArray();
        add('books', {
          id: book.id,
          title: book.title,
          author: book.author,
          source_format: book.sourceFormat,
          source_name: files.find(file => file.kind === 'source')?.name ?? `${book.title}.${book.sourceFormat}`,
          source_size: book.fileSizeBytes,
          source_path: fresh.cloudSourcePath ?? null,
          reference_name: fresh.referenceTitle ? files.find(file => file.kind === 'reference')?.name ?? null : null,
          reference_path: fresh.referenceTitle ? fresh.cloudReferencePath ?? null : null,
          reference_title: fresh.referenceTitle ?? null,
          created_at: book.createdAt,
          updated_at: now,
          deleted: false,
        });
        return true;
      }
      case 'progress': {
        const book = await db.books.get(entry.key);
        if (!book) return true;
        add('reading_progress', {
          book_id: book.id,
          chapter_index: book.lastReadChapterIndex ?? 0,
          sentence_index: await sentenceIndexOf(book.lastReadSentenceId),
          progress: book.readingProgress ?? 0,
          updated_at: book.progressUpdatedAt ?? book.lastOpenedAt ?? now,
        });
        return true;
      }
      case 'word': {
        const word = await db.wordProgress.get(entry.key);
        if (!word) return true;
        add('word_progress', { word: word.word, status: word.status, exposures: word.exposures, updated_at: word.updatedAt });
        return true;
      }
      case 'vocabulary': {
        const item = await db.vocabularyItems.where('word').equals(entry.key).first();
        add('vocabulary', item
          ? {
            word: item.word,
            pinyin: item.pinyin,
            meaning: item.meaning,
            part_of_speech: item.partOfSpeech,
            source_book_id: item.sourceBookId,
            source_book_title: item.sourceBookTitle,
            added_at: item.addedAt,
            updated_at: entry.at,
            deleted: false,
          }
          : { word: entry.key, added_at: 0, updated_at: entry.at, deleted: true });
        return true;
      }
      case 'bookmark': {
        const bookmark = await db.bookmarks.get(entry.key);
        add('bookmarks', bookmark
          ? {
            id: bookmark.id,
            book_id: bookmark.bookId,
            book_title: bookmark.bookTitle,
            chapter_index: bookmark.chapterIndex,
            chapter_title: bookmark.chapterTitle,
            sentence_index: await sentenceIndexOf(bookmark.sentenceId),
            preview_text: bookmark.previewText,
            created_at: bookmark.createdAt,
            updated_at: entry.at,
            deleted: false,
          }
          : { id: entry.key, book_id: '', chapter_index: 0, sentence_index: 0, created_at: 0, updated_at: entry.at, deleted: true });
        return true;
      }
      case 'settings': {
        const local = storage();
        const updatedAt = num(local?.getItem(SETTINGS_UPDATED_KEY));
        if (!local || updatedAt === 0) return true; // never changed here: keep the account's settings
        const data: Record<string, string> = {};
        for (const key of SETTINGS_KEYS) {
          const value = local.getItem(key);
          if (value !== null) data[key] = value;
        }
        add('settings', { data, updated_at: updatedAt });
        return true;
      }
    }
  }

  /** Upload original files not yet in the account. False when the source file is missing. */
  private async uploadBookFiles(book: Book): Promise<boolean> {
    const files = await db.bookFiles.where('bookId').equals(book.id).toArray();
    const source = files.find(file => file.kind === 'source');
    const reference = files.find(file => file.kind === 'reference');
    if (!book.cloudSourcePath) {
      if (!source) return false;
      this.report({ phase: 'push', detail: `Đang tải lên "${book.title}"…` });
      const path = versionedPath(this.userId, book.id, 'source');
      await this.api.upload(path, source.blob);
      await db.books.update(book.id, { cloudSourcePath: path });
      await this.removeOldVersions(book.id, 'source', path);
    }
    if (book.referenceTitle && reference && !book.cloudReferencePath) {
      this.report({ phase: 'push', detail: `Đang tải lên bản dịch của "${book.title}"…` });
      const path = versionedPath(this.userId, book.id, 'reference');
      await this.api.upload(path, reference.blob);
      await db.books.update(book.id, { cloudReferencePath: path });
      await this.removeOldVersions(book.id, 'reference', path);
    }
    return true;
  }

  private async removeOldVersions(bookId: string, kind: 'source' | 'reference', keep: string): Promise<void> {
    try {
      const paths = await this.api.list(bookFolder(this.userId, bookId));
      await this.api.remove(paths.filter(path => path !== keep && path.split('/').pop()!.startsWith(`${kind}-`)));
    } catch (error) {
      console.warn('Could not remove old file versions', error);
    }
  }

  // --- Rebuild books on this device ----------------------------------------

  private async downloadBook(row: CloudRow, changed: AppliedChanges): Promise<boolean> {
    const id = String(row.id);
    const title = String(row.title || 'Sách');
    try {
      let local = await db.books.get(id);
      if (!local) {
        const path = str(row.source_path);
        if (!path) return false;
        this.report({ phase: 'download', detail: `Đang tải "${title}" từ tài khoản…`, percent: 0 });
        const blob = await this.api.download(path);
        const file = new File([blob], str(row.source_name) ?? `${title}.${row.source_format || 'epub'}`);
        await this.hooks.importSource(file, id, (detail, percent) =>
          this.report({ phase: 'download', detail: `"${title}": ${detail}`, percent: Math.round(percent * 0.5) }));
        await db.bookFiles.put({ bookId: id, kind: 'source', name: file.name, blob: file });
        await db.books.update(id, { cloudSourcePath: path });
        local = await db.books.get(id);
      }
      const reference = str(row.reference_path);
      if (local && reference && reference !== local.cloudReferencePath) {
        this.report({ phase: 'download', detail: `Đang tải bản dịch của "${title}"…`, percent: 50 });
        const blob = await this.api.download(reference);
        const file = new File([blob], str(row.reference_name) ?? `${title} (bản dịch).epub`);
        await this.hooks.importReference(id, file, (detail, percent) =>
          this.report({ phase: 'download', detail: `"${title}": ${detail}`, percent: 50 + Math.round(percent * 0.5) }));
        await db.bookFiles.put({ bookId: id, kind: 'reference', name: file.name, blob: file });
        await db.books.update(id, { cloudReferencePath: reference });
      }
      // Position and bookmarks that arrived before the book existed here.
      for (const progress of await this.api.select('reading_progress', 'book_id', id)) await this.applyProgress(progress, changed, true);
      for (const bookmark of await this.api.select('bookmarks', 'book_id', id)) await this.applyBookmark(bookmark, changed);
      changed.books = true;
      return true;
    } catch (error) {
      console.error(`Failed to download book ${id}`, error);
      this.report({ phase: 'download', detail: `Không tải được "${title}": ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }
}
