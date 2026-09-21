import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let tokenize;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true },
  });
  ({ tokenize } = await vite.ssrLoadModule('/src/utils/tokenizer.ts'));
});

after(async () => {
  await vite?.close();
});

test('segments common words, domain terms and proper names without changing text', () => {
  const source = '制作说明，第一节：方源学习成为蛊师，踏入魔道并使用春秋蝉。';
  const tokens = tokenize(source);
  const words = tokens.filter(token => token.isWord).map(token => token.text);

  assert.equal(tokens.map(token => token.text).join(''), source);
  for (const expected of ['制作', '第一节', '方源', '学习', '蛊师', '魔道', '春秋蝉']) {
    assert.ok(words.includes(expected), `Missing meaningful token: ${expected}`);
  }
});

test('punctuation, whitespace, Latin text and numbers preserve rendering without dictionary targets', () => {
  const source = '学习 EPUB 3.0\n制作—test_42！';
  const tokens = tokenize(source);

  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.ok(tokens.filter(token => token.isWord).every(token => /^\p{Script=Han}+$/u.test(token.text)));
  assert.ok(tokens.filter(token => !token.isWord).some(token => token.text.includes('EPUB 3.0')));
});

test('falls back to clickable Han characters when Intl.Segmenter is unavailable', () => {
  const source = '未知词𠀀，方源。';
  const tokens = tokenize(source, null);

  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.deepEqual(
    tokens.filter(token => token.isWord).map(token => token.text),
    ['未', '知', '词', '𠀀', '方源'],
  );
});

test('tokenization cost stays bounded for 1k, 5k and 10k sentence books', (context) => {
  const sentence = '第一节：方源开始学习制作蛊虫，并以春秋蝉踏入魔道，成为蛊师。';
  const measurements = [];

  for (const count of [1_000, 5_000, 10_000]) {
    const startedAt = performance.now();
    let tokenCount = 0;
    for (let index = 0; index < count; index++) {
      const tokens = tokenize(`${sentence}${index}`);
      assert.equal(tokens.map(token => token.text).join(''), `${sentence}${index}`);
      tokenCount += tokens.length;
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    assert.ok(elapsedMs < 10_000, `${count} sentences took ${elapsedMs}ms`);
    measurements.push({ count, elapsedMs, tokenCount });
  }

  context.diagnostic(JSON.stringify(measurements));
});
