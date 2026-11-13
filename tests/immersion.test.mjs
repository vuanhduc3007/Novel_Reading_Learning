import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let matcher;
let units;
let reference;
let index;

before(async () => {
  vite = await createServer({ appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });
  matcher = await vite.ssrLoadModule('/src/features/immersion/wordMatcher.ts');
  units = await vite.ssrLoadModule('/src/features/immersion/readingUnits.ts');
  reference = await vite.ssrLoadModule('/src/features/reference/referenceImport.ts');
  const data = JSON.parse(fs.readFileSync(new URL('../src/data/hanviet.json', import.meta.url), 'utf8'));
  index = new matcher.HanVietIndex(data);
});

after(async () => {
  await vite?.close();
});

const woven = (zh, vi) => matcher.matchWords(zh, vi, index).map(match => `${match.zh}=${match.vi}`);

test('tone placement does not matter for syllable keys', () => {
  assert.equal(matcher.syllableKey('hoà'), matcher.syllableKey('hòa'));
  assert.equal(matcher.syllableKey('Thuỷ'), matcher.syllableKey('thủy'));
  assert.notEqual(matcher.syllableKey('ma'), matcher.syllableKey('mà'));
});

test('Hán-Việt cognates and names are matched to their Vietnamese span', () => {
  const result = woven('“若是刚炼成的春秋蝉有效，来生还是要做邪魔！”这般想着，方源情不自禁放声大笑。',
    '“Nếu như Xuân Thu Thiền vừa mới luyện thành có hiệu quả, vậy thì kiếp sau vẫn muốn làm ma!” Nghĩ như vậy, Phương Nguyên không kiềm được cất tiếng cười to.');
  assert.ok(result.includes('春秋蝉=Xuân Thu Thiền'), result.join(' '));
  assert.ok(result.includes('炼成=luyện thành'), result.join(' '));
  assert.ok(result.includes('方源=Phương Nguyên'), result.join(' '));
  // 方 alone must not claim "Phương" again once 方源 matched.
  assert.ok(!result.some(item => item.startsWith('方=')), result.join(' '));
});

test('idioms split by the segmenter are matched as a whole', () => {
  const result = woven('这里早已经布下天罗地网，这次你必定身首异处！', 'Nơi này đã sớm giăng thiên la địa võng, lần này ngươi nhất định phải đầu một nơi thân một nẻo!');
  assert.ok(result.includes('天罗地网=thiên la địa võng'), result.join(' '));
  assert.ok(result.includes('你=ngươi'), result.join(' '));
});

test('nothing is matched when the word is absent from the translation', () => {
  assert.deepEqual(woven('方源笑了。', 'Hắn cười.'), []);
});

test('merged reference sentences attach their Chinese to the sentence holding the text', () => {
  const base = { chapterId: 'c', bookId: 'b', vietnameseText: null, translationStatus: 'not_translated' };
  const list = units.readingUnits([
    { ...base, id: '1', index: 0, chineseText: '甲。', referenceText: '' },
    { ...base, id: '2', index: 1, chineseText: '乙。', referenceText: 'A và B.' },
    { ...base, id: '3', index: 2, chineseText: '丙。', vietnameseText: 'C.', translationStatus: 'ready' },
  ]);
  assert.equal(list[0].merged, true);
  assert.equal(list[1].chinese, '甲。乙。');
  assert.equal(list[1].source, 'reference');
  assert.equal(list[2].source, 'machine');
});

test('paragraphs of older books follow the Vietnamese paragraphs', () => {
  assert.deepEqual(reference.inferParagraphs([4, 4, 5, undefined, 6, 6]), [0, 0, 1, 2, 3, 3]);
});

test('a word repeated in the source is woven at each occurrence, parts of a matched word are not reused', () => {
  const result = woven('方源你个该死的魔头，你为了练成春秋蝉，杀了千万人的性命。',
    'Phương Nguyên, ngươi là tên ma đầu chết tiệt, ngươi vì luyện thành Xuân Thu Thiền đã giết ngàn vạn tính mệnh.');
  assert.equal(result.filter(item => item === '你=ngươi').length, 2, result.join(' '));
  assert.ok(result.includes('方源=Phương Nguyên'));
  assert.equal(result.filter(item => item.startsWith('方=')).length, 0, result.join(' '));
});
