import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let splitter;
let aligner;

before(async () => {
  vite = await createServer({ appType: 'custom', server: { middlewareMode: true } });
  splitter = await vite.ssrLoadModule('/src/features/library/sentenceSplitter.ts');
  aligner = await vite.ssrLoadModule('/src/features/reference/aligner.ts');
});

after(async () => {
  await vite?.close();
});

test('closing quotes stay with their sentence and newlines are boundaries', () => {
  const paragraphs = splitter.splitChineseParagraphs('第一节：标题\n“你好！”他说。\n然后走了……他知道！？“对。”');
  assert.deepEqual(paragraphs, [['第一节：标题'], ['“你好！”', '他说。'], ['然后走了……', '他知道！？', '“对。”']]);
  assert.equal(paragraphs.flat().join(''), '第一节：标题“你好！”他说。然后走了……他知道！？“对。”');
});

test('vietnamese sentences keep closing quotes', () => {
  assert.deepEqual(
    splitter.splitVietnameseSentences('“Ngươi giao ra đây!” Hắn nói. Được.'),
    ['“Ngươi giao ra đây!”', 'Hắn nói.', 'Được.'],
  );
});

// Synthetic stream: Vietnamese ≈ 3.6× Chinese length, with one merged pair,
// one skipped note and an extra Vietnamese chapter heading.
function makeChapter(lengths, seed) {
  return lengths.map((length, index) => (index % 3 === 0 ? '“' : '') + '字'.repeat(length) + seed);
}
function vietnamese(length, quote) {
  return (quote ? '“' : '') + 'a'.repeat(Math.round(length * 3.6));
}

test('streaming alignment follows chapters across different chapter boundaries', () => {
  const chapterA = makeChapter([12, 30, 8, 45, 20, 16, 33, 9, 27, 14], 'A');
  const chapterB = makeChapter([22, 11, 38, 17, 25, 6, 41, 19], 'B');
  const vi = [
    ...chapterA.slice(0, 5).map((text, i) => vietnamese(text.length - 1, i % 3 === 0)),
    'Chương 2: Tiêu đề mới', // edition splits chapter A into two chapters
    ...chapterA.slice(5).map((text, i) => vietnamese(text.length - 1, (i + 5) % 3 === 0)),
    ...chapterB.map((text, i) => vietnamese(text.length - 1, i % 3 === 0)),
  ].filter(text => !aligner.isVietnameseHeading(text));

  const stream = new aligner.StreamingAligner(vi);
  const first = stream.alignChapter(chapterA);
  assert.ok(first.accepted);
  assert.deepEqual(aligner.normalizeBeads(first.beads).map(bead => [bead.zh, bead.vi]),
    chapterA.map((_, i) => [[i], [i]]));
  const second = stream.alignChapter(chapterB);
  assert.ok(second.accepted);
  assert.equal(second.beads[0].vi[0], chapterA.length);
  assert.equal(stream.position, vi.length);
});

test('a chapter missing from the translation is rejected without shifting the stream', () => {
  const present = makeChapter([12, 30, 8, 45, 20, 16, 33, 9, 27, 14], 'A');
  const missing = makeChapter([50, 3, 3, 60, 4, 70, 2, 55], 'X');
  const vi = present.map((text, i) => vietnamese(text.length - 1, i % 3 === 0));
  const stream = new aligner.StreamingAligner(vi);
  const rejected = stream.alignChapter(missing);
  assert.equal(rejected.accepted, false);
  assert.equal(stream.position, 0);
  assert.ok(stream.alignChapter(present).accepted);
});
