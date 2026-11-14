import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { createServer } from 'vite';

/**
 * Two "devices" (separate IndexedDB + localStorage + module instances) share
 * one in-memory cloud and sync through the real SyncEngine.
 */

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

async function makeDevice(name) {
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  Dexie.dependencies.indexedDB = new IDBFactory();
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  const vite = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false }, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
  const load = path => vite.ssrLoadModule(path);
  const device = {
    name, storage, vite,
    db: (await load('/src/db/database.ts')).db,
    engineModule: await load('/src/features/sync/syncEngine.ts'),
    importEngine: await load('/src/features/library/importEngine.ts'),
    reference: await load('/src/features/reference/referenceImport.ts'),
    changes: await load('/src/features/sync/localChanges.ts'),
  };
  device.hooks = {
    importSource: (file, bookId) => device.importEngine.importBook(file, undefined, { bookId, fromCloud: true }).then(() => undefined),
    importReference: (bookId, file) => device.reference.importReferenceTranslation(bookId, file, undefined, { fromCloud: true }).then(() => undefined),
    removeReference: bookId => device.reference.removeReferenceTranslation(bookId, { fromCloud: true }),
    deleteLocalBook: bookId => device.importEngine.deleteBook(bookId, { fromCloud: true }),
    afterApply: () => undefined,
  };
  return device;
}

let cloud;
let A;
let B;
const USER = '00000000-0000-0000-0000-000000000001';

/** Run `fn` with the device's localStorage active (localStorage is global). */
async function on(device, fn) {
  globalThis.localStorage = device.storage;
  return fn();
}

async function sync(device) {
  return on(device, async () => {
    // markDirty writes asynchronously; let pending writes land first.
    await new Promise(resolve => setTimeout(resolve, 20));
    const engine = new device.engineModule.SyncEngine(cloud, USER, device.hooks);
    return engine.run();
  });
}

function chineseBook() {
  const chapter = (n, name) => [
    `第${n}章 ${name}`,
    ...Array.from({ length: 12 }, (_, i) => `方源看着春秋蝉，心中想到第${i + 1}件事情，于是慢慢地走向山寨的大门，古月家族的人都在那里等着他。`),
  ].join('\n');
  return [chapter('一', '开始'), chapter('二', '继续')].join('\n');
}

before(async () => {
  A = await makeDevice('A');
  B = await makeDevice('B');
  const { MemoryCloud } = await A.vite.ssrLoadModule('/src/features/sync/cloudApi.ts');
  cloud = new MemoryCloud();
});

after(async () => {
  await A?.vite.close();
  await B?.vite.close();
});

let bookId;

test('device A: a new book, progress, words, vocabulary, bookmark and settings reach the cloud', async () => {
  await on(A, async () => {
    const file = new File([chineseBook()], '蛊真人.txt', { type: 'text/plain' });
    bookId = await A.importEngine.importBook(file);
    const chapters = await A.db.chapters.where('bookId').equals(bookId).sortBy('index');
    const target = await A.db.sentences.where('[chapterId+index]').equals([chapters[1].id, 5]).first();
    await A.db.books.update(bookId, { lastReadChapterIndex: 1, lastReadSentenceId: target.id, readingProgress: 50, progressUpdatedAt: Date.now() });
    A.changes.markDirty('progress', bookId);
    await A.db.wordProgress.put({ word: '方源', status: 'known', exposures: 12, updatedAt: Date.now() });
    A.changes.markDirty('word', '方源');
    await A.db.vocabularyItems.add({ id: 'v1', word: '春秋蝉', pinyin: 'chūn qiū chán', meaning: 'Xuân Thu Thiền', partOfSpeech: null, sourceBookId: bookId, sourceBookTitle: '蛊真人', sourceBookAvailable: true, sourceSentenceId: target.id, isKnown: true, addedAt: Date.now() });
    A.changes.markDirty('vocabulary', '春秋蝉');
    await A.db.bookmarks.add({ id: 'bm1', bookId, bookTitle: '蛊真人', chapterId: chapters[1].id, chapterTitle: chapters[1].title, chapterIndex: 1, sentenceId: target.id, previewText: 'x', createdAt: Date.now() });
    A.changes.markDirty('bookmark', 'bm1');
    localStorage.setItem('reader-mode', 'on_demand');
    A.changes.markSettingsChanged();
  });
  const result = await sync(A);
  assert.deepEqual(result.missingFiles, []);
  const book = await A.db.books.get(bookId);
  assert.ok(book.cloudSourcePath, 'source uploaded');
  assert.ok(cloud.files.has(book.cloudSourcePath));
  assert.equal(cloud.tables.get('books').size, 1);
  assert.equal([...cloud.tables.get('reading_progress').values()][0].sentence_index, 5);
  assert.equal(await A.db.syncDirty.count(), 0, 'queue drained');
});

test('device B: signing in rebuilds the book with the same id and applies everything', async () => {
  const result = await sync(B);
  assert.deepEqual(result.downloadedBooks, [bookId]);
  const book = await B.db.books.get(bookId);
  assert.equal(book.importStatus, 'ready_to_read');
  assert.equal(book.lastReadChapterIndex, 1);
  const sentence = await B.db.sentences.get(book.lastReadSentenceId);
  assert.equal(sentence.index, 5, 'same sentence position as on A');
  assert.equal((await B.db.wordProgress.get('方源')).status, 'known');
  assert.ok(await B.db.vocabularyItems.where('word').equals('春秋蝉').first());
  const bookmark = await B.db.bookmarks.get('bm1');
  assert.equal(bookmark.chapterIndex, 1);
  assert.equal((await B.db.sentences.get(bookmark.sentenceId)).index, 5);
  assert.equal(B.storage.getItem('reader-mode'), 'on_demand');
  // Rebuilding from the cloud must not upload the book again.
  const before = cloud.files.size;
  await sync(B);
  assert.equal(cloud.files.size, before);
});

test('changes made on B flow back to A; the newer write wins', async () => {
  await on(B, async () => {
    const chapters = await B.db.chapters.where('bookId').equals(bookId).sortBy('index');
    const target = await B.db.sentences.where('[chapterId+index]').equals([chapters[1].id, 9]).first();
    await B.db.books.update(bookId, { lastReadSentenceId: target.id, readingProgress: 75, progressUpdatedAt: Date.now() + 1000 });
    B.changes.markDirty('progress', bookId);
    const item = await B.db.vocabularyItems.where('word').equals('春秋蝉').first();
    await B.db.vocabularyItems.delete(item.id);
    B.changes.markDirty('vocabulary', '春秋蝉');
  });
  await sync(B);
  await sync(A);
  const book = await A.db.books.get(bookId);
  assert.equal((await A.db.sentences.get(book.lastReadSentenceId)).index, 9);
  assert.equal(await A.db.vocabularyItems.where('word').equals('春秋蝉').count(), 0);
});

test('an older local position does not overwrite a newer one from the cloud', async () => {
  await on(A, async () => {
    const chapters = await A.db.chapters.where('bookId').equals(bookId).sortBy('index');
    const stale = await A.db.sentences.where('[chapterId+index]').equals([chapters[0].id, 2]).first();
    await A.db.books.update(bookId, { lastReadChapterIndex: 0, lastReadSentenceId: stale.id, progressUpdatedAt: 1 });
    A.changes.markDirty('progress', bookId);
  });
  await sync(A);
  const book = await A.db.books.get(bookId);
  assert.equal(book.lastReadChapterIndex, 1, 'cloud position (newer) kept');
  assert.equal([...cloud.tables.get('reading_progress').values()][0].sentence_index, 9);
});

test('a human translation attached on A is rebuilt on B', async () => {
  await on(A, async () => {
    const vi = [
      'Chương 1: Bắt đầu',
      ...Array.from({ length: 12 }, (_, i) => `Phương Nguyên nhìn Xuân Thu Thiền, trong lòng nghĩ tới việc thứ ${i + 1}, rồi chậm rãi đi về phía cổng sơn trại, người của gia tộc Cổ Nguyệt đều đang chờ hắn ở đó.`),
      'Chương 2: Tiếp tục',
      ...Array.from({ length: 12 }, (_, i) => `Phương Nguyên nhìn Xuân Thu Thiền, trong lòng nghĩ tới việc thứ ${i + 1}, rồi chậm rãi đi về phía cổng sơn trại, người của gia tộc Cổ Nguyệt đều đang chờ hắn ở đó.`),
    ].join('\n');
    await A.reference.importReferenceTranslation(bookId, new File([vi], 'co-chan-nhan.txt', { type: 'text/plain' }));
  });
  await sync(A);
  const pathOnA = (await A.db.books.get(bookId)).cloudReferencePath;
  assert.ok(pathOnA);
  await sync(B);
  const bookOnB = await B.db.books.get(bookId);
  assert.equal(bookOnB.cloudReferencePath, pathOnA);
  assert.ok(bookOnB.referenceTitle);
});

test('deleting the book on A removes it from the cloud and from B', async () => {
  await on(A, () => A.importEngine.deleteBook(bookId));
  await sync(A);
  assert.equal([...cloud.files.keys()].filter(path => path.includes(bookId)).length, 0, 'files removed');
  await sync(B);
  assert.equal(await B.db.books.get(bookId), undefined);
  assert.equal(await B.db.sentences.where('bookId').equals(bookId).count(), 0);
});

test('a book imported before accounts (no original file kept) is reported, not uploaded', async () => {
  let oldBookId;
  await on(A, async () => {
    oldBookId = await A.importEngine.importBook(new File([chineseBook()], 'old.txt', { type: 'text/plain' }));
    await A.db.bookFiles.where('bookId').equals(oldBookId).delete();
  });
  const result = await sync(A);
  assert.deepEqual(result.missingFiles, [oldBookId]);
  assert.equal(cloud.tables.get('books').get(oldBookId), undefined);
  // Choosing the file again uploads it.
  await on(A, async () => {
    await A.changes.keepBookFile(oldBookId, 'source', new File([chineseBook()], 'old.txt', { type: 'text/plain' }));
    A.changes.markDirty('book', oldBookId);
  });
  assert.deepEqual((await sync(A)).missingFiles, []);
  assert.equal(cloud.tables.get('books').get(oldBookId).deleted, false);
});
