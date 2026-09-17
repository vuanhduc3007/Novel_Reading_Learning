const fs = require('fs');

function replaceInFile(path, replacements) {
  let content = fs.readFileSync(path, 'utf8');
  for (const [search, replace] of replacements) {
    content = content.replace(search, replace);
  }
  fs.writeFileSync(path, content, 'utf8');
}

replaceInFile('src/features/library/BookCard.tsx', [
  [/book\.status/g, 'book.importStatus'],
  [/progress=\{book\.progress\}/g, 'value={book.readingProgress}'],
  [/onCancel=/g, 'onClose='],
  [/message: `Đã xóa "\$\{book\.title\}"`/g, 'message: `Đã xóa "${book.title}"`, variant: "success"'],
  [/message: 'Lỗi khi xóa sách'/g, 'message: "Lỗi khi xóa sách", variant: "error"']
]);

replaceInFile('src/features/library/BookDetailPage.tsx', [
  [/book\.progress/g, 'book.readingProgress'],
  [/book\.coverImage/g, 'book.coverUrl'],
  [/book\.format/g, 'book.sourceFormat'],
  [/book\.fileSize/g, 'book.fileSizeBytes'],
  [/variant="danger"/g, 'variant="destructive"'],
  [/variant="outline"/g, 'variant="ghost"'],
  [/variant="primary"/g, 'variant="default"'],
  [/variant="default"/g, 'variant="labeled"'],
  [/progress=\{book\.readingProgress\}/g, 'value={book.readingProgress}']
]);

replaceInFile('src/features/library/BookRow.tsx', [
  [/progress=\{book\.progress\}/g, 'value={book.readingProgress}']
]);

replaceInFile('src/features/library/ImportProcessing.tsx', [
  [/progress=\{importProgress/g, 'value={importProgress']
]);

replaceInFile('src/utils/tokenizer.ts', [
  [/word: string \| undefined/g, 'word: string']
]);

console.log("Fixed!");
