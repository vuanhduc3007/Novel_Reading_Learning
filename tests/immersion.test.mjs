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

test('a word being learned is found whatever the browser segmenter does', () => {
  const zh = '蛊师修行需要元石，战斗需要元石，炼蛊需要元石，交易需要元石。';
  const vi = 'Cổ sư tu hành cần nguyên thạch, chiến đấu cần nguyên thạch, luyện cổ cần nguyên thạch, giao dịch cần nguyên thạch.';
  const preferred = matcher.matchWords(zh, vi, index, { prefer: word => word === '元石' }).map(match => `${match.zh}=${match.vi}`);
  assert.equal(preferred.filter(pair => pair === '元石=nguyên thạch').length, 4, preferred.join(', '));
});

test('words being learned are matched before a longer span around them', () => {
  const zh = '蛊师修行需要元石。';
  const vi = 'Cổ sư tu hành cần nguyên thạch.';
  assert.ok(woven(zh, vi).includes('蛊师修行=Cổ sư tu hành'));
  const preferred = matcher.matchWords(zh, vi, index, { prefer: word => word === '蛊师' }).map(match => `${match.zh}=${match.vi}`);
  assert.ok(preferred.includes('蛊师=Cổ sư'), preferred.join(', '));
  assert.ok(preferred.includes('元石=nguyên thạch'));
});

test('a word takes the Vietnamese span at about the same place in the sentence', () => {
  const zh = '人家一个小丫头，服侍了你这么多年，对你的温柔体贴我都一一看在眼里。';
  const vi = 'Người ta là một tiểu nha đầu, hầu hạ ngươi nhiều năm ra sao, dịu dàng săn sóc ngươi ra sao, ta đều thấy hết vào mắt.';
  const matches = matcher.matchWords(zh, vi, index, { prefer: word => word === '我' || word === '人' });
  const wo = matches.find(match => match.zh === '我');
  assert.ok(wo, 'matches 我');
  assert.equal(vi.slice(wo.viStart, wo.viStart + 6), 'ta đều');
  assert.ok(woven(zh, vi).includes('人家=Người ta'), woven(zh, vi).join(', '));
});

test('a lexicon word is matched as a whole even if the segmenter splits it', () => {
  // As if the browser had split 人家 into 人 / 家 and 人 were being learned.
  const matches = matcher.matchWords('人家是小丫头。', 'Người ta là tiểu nha đầu.', index, { prefer: word => word === '人' })
    .map(match => `${match.zh}=${match.vi}`);
  assert.ok(matches.includes('人家=Người ta'), matches.join(', '));
  assert.ok(!matches.includes('人=Người'));
});

test('a longer span not shown here does not take the place of words being learned', () => {
  const zh = '他大声吼道：“古月方源，你怎么能这个样子！';
  const vi = 'Hắn rống to: “Cổ Nguyệt Phương Nguyên, làm sao ngươi có thể như vậy!';
  const shown = word => word === '古月' || word === '方源';
  const matches = matcher.matchWords(zh, vi, index, { prefer: shown }).filter(match => shown(match.zh)).map(match => `${match.zh}=${match.vi}`);
  assert.deepEqual(matches, ['古月=Cổ Nguyệt', '方源=Phương Nguyên']);
});

test('a compound of two free words is matched as its two words', () => {
  const free = new Set(['古月', '方源', '族长', '蛊师', '修行']);
  const isFreeWord = word => free.has(word);
  assert.equal(matcher.isCompound('古月方源', isFreeWord), true);
  assert.equal(matcher.isCompound('天罗地网', isFreeWord), false, 'an idiom whose pieces are not free words');
  assert.equal(matcher.isCompound('古月博', isFreeWord), false, 'a name is not split');
  const pairs = (zh, vi) => matcher.matchWords(zh, vi, index, { isFreeWord }).map(match => `${match.zh}=${match.vi}`);
  assert.deepEqual(pairs('“古月方源！”', '“Cổ Nguyệt Phương Nguyên!”'), ['古月=Cổ Nguyệt', '方源=Phương Nguyên']);
  // 族长古月 must not cut the name 古月博.
  const chief = pairs('族长古月博问道。', 'Tộc trưởng Cổ Nguyệt Bác hỏi.');
  assert.ok(chief.includes('族长=Tộc trưởng') && chief.includes('古月博=Cổ Nguyệt Bác'), chief.join(', '));
  assert.ok(pairs('蛊师修行需要元石。', 'Cổ sư tu hành cần nguyên thạch.').includes('蛊师=Cổ sư'));
});

test('word statistics count a compound for its two words, never as a word', async () => {
  const stats = await vite.ssrLoadModule('/src/features/immersion/wordStats.ts');
  const counter = new stats.WordCounter();
  const sentence = (index, chineseText, referenceText) => ({ id: `s${index}`, index, chineseText, referenceText });
  const lines = [];
  for (let i = 0; i < 6; i++) lines.push(sentence(lines.length, '古月来了。', 'Cổ Nguyệt đến rồi.'), sentence(lines.length + 1, '方源来了。', 'Phương Nguyên đến rồi.'));
  for (let i = 0; i < 3; i++) lines.push(sentence(lines.length, '古月方源来了。', 'Cổ Nguyệt Phương Nguyên đến rồi.'));
  counter.addSentences(lines, index);
  const result = counter.toStats('b');
  const count = word => result.words.find(([w]) => w === word)?.[1] ?? 0;
  assert.equal(count('古月方源'), 0);
  assert.equal(count('古月'), 9);
  assert.equal(count('方源'), 9);
  assert.equal(result.version, stats.STATS_VERSION);
});

test('a single character being learned is found outside words, whatever the segmenter does', () => {
  // Chrome on a desktop keeps 我知道 as one token.
  const zh = '是，我知道你很失落。';
  const vi = 'Phải, ta biết ngươi rất hụt hẫng.';
  const known = new Set(['我', '你']);
  const pairs = matcher.matchWords(zh, vi, index, { prefer: word => known.has(word) }).map(match => `${match.zh}=${match.vi}`);
  assert.ok(pairs.includes('我=ta'), pairs.join(', '));
  // 是 inside the word 但是 is not 是 on its own.
  const both = matcher.matchWords('但是你是谁？', 'Nhưng ngươi là ai?', index, { prefer: word => word === '是', isFreeWord: word => word === '但是' });
  assert.equal(both.filter(match => match.zh === '是').length, 1);
});
