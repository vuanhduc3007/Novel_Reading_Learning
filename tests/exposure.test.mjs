import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { createServer } from 'vite';

let vite;
let db;
let tracker;
const BOOK = 'book-1';

before(async () => {
  Dexie.dependencies.indexedDB = new IDBFactory();
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  vite = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false }, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
  db = (await vite.ssrLoadModule('/src/db/database.ts')).db;
  tracker = await vite.ssrLoadModule('/src/features/immersion/exposureTracker.ts');
  await db.books.add({ id: BOOK, title: 't', author: '', coverUrl: null, sourceFormat: 'txt', fileSizeBytes: 0, importStatus: 'ready_to_read', translationProgress: 0, readingProgress: 0, lastReadSentenceId: null, lastReadChapterIndex: 0, lastOpenedAt: null, createdAt: 0, chapterCount: 3 });
  await db.chapters.bulkAdd([0, 1, 2].map(index => ({ id: `c${index}`, bookId: BOOK, index, title: '', sentenceCount: 50 })));
  await db.sentences.bulkAdd([0, 1, 2].flatMap(chapter => Array.from({ length: 50 }, (_, index) => ({
    id: `s${chapter}-${index}`, chapterId: `c${chapter}`, bookId: BOOK, index, chineseText: '', vietnameseText: null, translationStatus: 'not_translated',
  }))));
});

after(async () => {
  tracker?.stopExposureTracking();
  await new Promise(resolve => setTimeout(resolve, 50));
  await vite?.close();
});

const reopen = async () => {
  tracker.stopExposureTracking();
  await new Promise(resolve => setTimeout(resolve, 20));
  await tracker.startExposureTracking(BOOK);
};

test('new text counts, at most 3 times per word per chapter', async () => {
  await tracker.startExposureTracking(BOOK);
  const counted = [];
  for (let sentence = 0; sentence < 6; sentence++) counted.push(...tracker.countEncounters(BOOK, 0, sentence, ['方源']));
  assert.equal(counted.length, 3);
  assert.deepEqual(tracker.countEncounters(BOOK, 1, 0, ['方源']), ['方源'], 'a new chapter counts again');
});

test('re-reading earlier text does not count', async () => {
  assert.deepEqual(tracker.countEncounters(BOOK, 0, 10, ['他']), []);
  assert.deepEqual(tracker.countEncounters(BOOK, 1, 0, ['他']), [], 'the same sentence again');
  assert.deepEqual(tracker.countEncounters(BOOK, 1, 1, ['他']), ['他']);
});

test('reopening the book: the resumed screen and the per-chapter cap are remembered', async () => {
  tracker.countEncounters(BOOK, 1, 2, ['方源']);
  tracker.countEncounters(BOOK, 1, 3, ['方源']);
  await db.books.update(BOOK, { lastReadChapterIndex: 1, lastReadSentenceId: 's1-2' });
  await reopen();
  assert.deepEqual(tracker.countEncounters(BOOK, 1, 2, ['方源']), [], 'resume position was read');
  assert.deepEqual(tracker.countEncounters(BOOK, 1, 3, ['方源']), [], 'beyond resume but already counted before closing');
  assert.deepEqual(tracker.countEncounters(BOOK, 1, 4, ['方源']), [], 'cap of 3 in chapter 1 survives the reload');
  assert.deepEqual(tracker.countEncounters(BOOK, 1, 5, ['我']), ['我']);
});

test('resuming further ahead (read on another device) skips what was read there', async () => {
  await db.books.update(BOOK, { lastReadChapterIndex: 2, lastReadSentenceId: 's2-20' });
  await reopen();
  assert.deepEqual(tracker.countEncounters(BOOK, 2, 10, ['他']), []);
  assert.deepEqual(tracker.countEncounters(BOOK, 2, 21, ['他']), ['他']);
});
