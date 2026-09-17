const fs = require('fs');
const path = require('path');

const SENTENCE_POOL = [
  "第一句话是关于这个测试的开始。",
  "我们需要确保系统可以处理长文本。",
  "在这个村庄里，有一位智慧的老人。",
  "每天早上，他都会在树下读书。",
  "这是一个庞大书籍的模拟测试，用于验证架构。",
  "如果性能很好，说明我们的方向是对的。",
  "今天的天气非常适合在户外散步。",
  "阅读是人类进步的阶梯。",
  "请注意内存和渲染性能的变化。",
  "测试十个句子一段落，共计很多章节。"
];

function generateBook(sizeSentences, filename) {
  let content = '';
  let sentenceCount = 0;
  let chapterCount = 1;

  while (sentenceCount < sizeSentences) {
    content += `第${chapterCount}章 测试章节\n\n`;
    
    // Each chapter has 100 sentences
    let chapterSentences = 0;
    while (chapterSentences < 100 && sentenceCount < sizeSentences) {
      // Paragraphs of 5 sentences
      for (let i = 0; i < 5 && chapterSentences < 100 && sentenceCount < sizeSentences; i++) {
        content += SENTENCE_POOL[Math.floor(Math.random() * SENTENCE_POOL.length)];
        chapterSentences++;
        sentenceCount++;
      }
      content += '\n\n';
    }
    chapterCount++;
  }

  const outPath = path.join(__dirname, '..', filename);
  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`Generated ${filename} with ${sentenceCount} sentences.`);
}

generateBook(1000, 'test-book-1k.txt');
generateBook(5000, 'test-book-5k.txt');
generateBook(10000, 'test-book-10k.txt');

