import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { createServer } from 'vite';

let vite;
let store;

before(async () => {
  Dexie.dependencies.indexedDB = new IDBFactory();
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  globalThis.localStorage ??= { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vite = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false }, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
  store = await vite.ssrLoadModule('/src/stores/immersionStore.ts');
});

after(async () => {
  await new Promise(resolve => setTimeout(resolve, 2200)); // pending progress flush
  await vite?.close();
});

const stats = { bookId: 'b', builtAt: 0, words: [['方源', 900, ''], ['他', 500, ''], ['蛊', 300, ''], ['古月', 200, '']] };

test('new words come from the upcoming chapters first; started words stay', () => {
  const progress = new Map([['他', { word: '他', status: 'learning', exposures: 3, updatedAt: 0 }]]);
  const upcoming = new Map([['古月', 40], ['蛊', 12], ['方源', 2]]);
  const { learning } = store.computeSets(stats, progress, 3, upcoming);
  assert.deepEqual([...learning], ['他', '古月', '蛊'], 'started 他, then densest upcoming; 方源 is rare ahead');
  const { learning: whole } = store.computeSets(stats, new Map(), 2, null);
  assert.deepEqual([...whole], ['方源', '他'], 'without upcoming counts: whole-book frequency');
});

test('a word is known after 15 recalls in a row without peeking; peeking resets the streak', () => {
  const { useImmersionStore, HINT_EXPOSURES, RECALL_STREAK } = store;
  useImmersionStore.setState({
    learning: new Set(['方源']),
    known: new Set(),
    progress: new Map([['方源', { word: '方源', status: 'learning', exposures: HINT_EXPOSURES, updatedAt: 0 }]]),
  });
  const state = () => useImmersionStore.getState().progress.get('方源');
  for (let i = 0; i < 10; i++) useImmersionStore.getState().recordExposures(['方源']);
  assert.equal(state().streak, 10);
  useImmersionStore.getState().peek('方源');
  assert.equal(state().streak, 0);
  assert.ok(state().exposures < HINT_EXPOSURES, 'hint shows again after peeking');
  // Back above the hint threshold, then a clean run of RECALL_STREAK.
  while (state().exposures < HINT_EXPOSURES) useImmersionStore.getState().recordExposures(['方源']);
  for (let i = 0; i < RECALL_STREAK - 1; i++) useImmersionStore.getState().recordExposures(['方源']);
  assert.equal(state().status, 'learning');
  useImmersionStore.getState().recordExposures(['方源']);
  assert.equal(state().status, 'known');
});

test('learning words never appear in text read before; known words always do', () => {
  const state = {
    known: new Set(['他']),
    learning: new Set(['方源', '古月']),
    sessionStart: { chapter: 5, sentence: 20 },
    visibleFrom: new Map([['古月', { chapter: 6, sentence: 3 }]]),
  };
  assert.equal(store.canWeave('他', 1, 0, state), true);
  assert.equal(store.canWeave('方源', 5, 20, state), false, 'read in an earlier session');
  assert.equal(store.canWeave('方源', 5, 21, state), true);
  assert.equal(store.canWeave('古月', 6, 3, state), false, 'introduced at 6:3');
  assert.equal(store.canWeave('古月', 6, 4, state), true);
  assert.equal(store.canWeave('蛊', 9, 9, state), false, 'not being learned');
});
