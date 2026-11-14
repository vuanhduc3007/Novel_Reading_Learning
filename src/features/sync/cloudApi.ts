import type { SupabaseClient } from '@supabase/supabase-js';

export type CloudTable = 'books' | 'reading_progress' | 'word_progress' | 'vocabulary' | 'bookmarks' | 'settings';

export interface CloudRow {
  [column: string]: unknown;
  /** Database clock of the last write (ISO), used as the pull watermark. */
  server_at?: string;
}

/**
 * Everything the sync engine needs from the backend. The Supabase
 * implementation is used by the app; tests use an in-memory one.
 */
export interface CloudApi {
  upsert(table: CloudTable, rows: CloudRow[]): Promise<void>;
  /** Rows written after `since` (database clock, ISO string), oldest first. */
  pull(table: CloudTable, since: string | null): Promise<CloudRow[]>;
  /** Rows of one table matching an equality filter. */
  select(table: CloudTable, column: string, value: string): Promise<CloudRow[]>;
  /** Rows whose `column` is one of `values`. */
  selectIn(table: CloudTable, column: string, values: string[]): Promise<CloudRow[]>;
  upload(path: string, blob: Blob): Promise<void>;
  download(path: string): Promise<Blob>;
  remove(paths: string[]): Promise<void>;
  /** Paths of the files directly inside a folder. */
  list(folder: string): Promise<string[]>;
}

export const BUCKET = 'books';
const PAGE_SIZE = 1000;

const PRIMARY_KEYS: Record<CloudTable, string> = {
  books: 'user_id,id',
  reading_progress: 'user_id,book_id',
  word_progress: 'user_id,word',
  vocabulary: 'user_id,word',
  bookmarks: 'user_id,id',
  settings: 'user_id',
};

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export class SupabaseCloud implements CloudApi {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(table: CloudTable, rows: CloudRow[]): Promise<void> {
    for (let start = 0; start < rows.length; start += PAGE_SIZE) {
      const { error } = await this.client.from(table).upsert(rows.slice(start, start + PAGE_SIZE), {
        onConflict: PRIMARY_KEYS[table],
      });
      fail(`Lưu ${table}`, error);
    }
  }

  async pull(table: CloudTable, since: string | null): Promise<CloudRow[]> {
    const rows: CloudRow[] = [];
    for (let page = 0; ; page++) {
      let query = this.client.from(table).select('*').order('server_at', { ascending: true });
      if (since) query = query.gt('server_at', since);
      const { data, error } = await query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      fail(`Tải ${table}`, error);
      rows.push(...((data ?? []) as CloudRow[]));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  async select(table: CloudTable, column: string, value: string): Promise<CloudRow[]> {
    const { data, error } = await this.client.from(table).select('*').eq(column, value);
    fail(`Tải ${table}`, error);
    return (data ?? []) as CloudRow[];
  }

  async selectIn(table: CloudTable, column: string, values: string[]): Promise<CloudRow[]> {
    const rows: CloudRow[] = [];
    for (let start = 0; start < values.length; start += 100) {
      const { data, error } = await this.client.from(table).select('*').in(column, values.slice(start, start + 100));
      fail(`Tải ${table}`, error);
      rows.push(...((data ?? []) as CloudRow[]));
    }
    return rows;
  }

  async upload(path: string, blob: Blob): Promise<void> {
    const { error } = await this.client.storage.from(BUCKET).upload(path, blob, {
      upsert: true,
      contentType: blob.type || 'application/octet-stream',
    });
    fail('Tải file lên', error);
  }

  async download(path: string): Promise<Blob> {
    const { data, error } = await this.client.storage.from(BUCKET).download(path);
    fail('Tải file về', error);
    if (!data) throw new Error('Tải file về: không có dữ liệu');
    return data;
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.client.storage.from(BUCKET).remove(paths);
    fail('Xoá file', error);
  }

  async list(folder: string): Promise<string[]> {
    const { data, error } = await this.client.storage.from(BUCKET).list(folder, { limit: 100 });
    fail('Liệt kê file', error);
    return (data ?? []).map(entry => `${folder}/${entry.name}`);
  }
}

/** In-memory backend with the same semantics, for tests and local demos. */
export class MemoryCloud implements CloudApi {
  readonly tables = new Map<CloudTable, Map<string, CloudRow>>();
  readonly files = new Map<string, Blob>();
  private clock = 0;

  private table(name: CloudTable): Map<string, CloudRow> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  private key(name: CloudTable, row: CloudRow): string {
    return PRIMARY_KEYS[name].split(',').filter(column => column !== 'user_id').map(column => String(row[column])).join('|') || 'row';
  }

  async upsert(name: CloudTable, rows: CloudRow[]): Promise<void> {
    const table = this.table(name);
    for (const row of rows) {
      const key = this.key(name, row);
      const existing = table.get(key);
      // Same rule as the database trigger: an older write is ignored.
      if (existing && Number(row.updated_at) < Number(existing.updated_at)) continue;
      this.clock++;
      table.set(key, { ...row, server_at: new Date(Date.UTC(2026, 0, 1) + this.clock).toISOString() });
    }
  }

  async pull(name: CloudTable, since: string | null): Promise<CloudRow[]> {
    return [...this.table(name).values()]
      .filter(row => !since || String(row.server_at) > since)
      .sort((a, b) => String(a.server_at).localeCompare(String(b.server_at)));
  }

  async select(name: CloudTable, column: string, value: string): Promise<CloudRow[]> {
    return [...this.table(name).values()].filter(row => row[column] === value);
  }

  async selectIn(name: CloudTable, column: string, values: string[]): Promise<CloudRow[]> {
    const wanted = new Set(values);
    return [...this.table(name).values()].filter(row => wanted.has(String(row[column])));
  }

  async upload(path: string, blob: Blob): Promise<void> {
    this.files.set(path, blob);
  }

  async download(path: string): Promise<Blob> {
    const blob = this.files.get(path);
    if (!blob) throw new Error(`Không có file ${path}`);
    return blob;
  }

  async remove(paths: string[]): Promise<void> {
    for (const path of paths) this.files.delete(path);
  }

  async list(folder: string): Promise<string[]> {
    return [...this.files.keys()].filter(path => path.startsWith(`${folder}/`) && !path.slice(folder.length + 1).includes('/'));
  }
}
