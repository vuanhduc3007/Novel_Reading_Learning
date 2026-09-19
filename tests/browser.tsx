// Browser-native regression: real DOMParser, File, IndexedDB and application modules.
// Run via Vite on an isolated local origin; never against a user's normal library.
import React, { StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import Dexie from 'dexie';
import JSZip from 'jszip';
import { App } from '../src/App';
import { ToastProvider } from '../src/components/Toast/ToastContext';
import { db } from '../src/db/database';
import { importBook, replaceBook, deleteBook } from '../src/features/library/importEngine';
import { parseEpub } from '../src/features/library/epubParser';
import { splitChineseSentences } from '../src/features/library/sentenceSplitter';
import { toggleBookmark } from '../src/features/bookmarks/bookmarkService';
import { useReaderStore as reader } from '../src/stores/readerStore';
import { useLibraryStore as library } from '../src/stores/libraryStore';
import { useVocabularyStore as vocabulary } from '../src/stores/vocabularyStore';
import { useDictionaryStore as dictionary } from '../src/stores/dictionaryStore';
import { lookupWord } from '../src/features/dictionary/dictionaryService';
import { translationQueue } from '../src/features/translation/translationQueue';
import { translationProvider, ApiTranslationProvider } from '../src/features/translation/TranslationProvider';
import { useAppStore } from '../src/stores/appStore';
import '../src/styles/global.css';

const output = document.querySelector('#results')!;
const host = document.querySelector('#app')!;
const results: object[] = [];
const owned = new Set<string>();
let root: Root | undefined;
let navigate: ReturnType<typeof useNavigate>;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function log(name: string, status: string, detail: unknown) {
  results.push({name, status, detail}); output.textContent = JSON.stringify(results, null, 2);
}
async function test(name: string, run: () => Promise<unknown>) {
  try { log(name, 'PASS', await run() ?? 'ok'); } catch (error) { log(name, 'FAIL', String(error)); }
}
async function until(check: () => unknown | Promise<unknown>, message: string, ms = 10000) {
  const start = performance.now();
  while (!await check()) { if (performance.now() - start > ms) throw new Error(message); await delay(20); }
}
function Harness() { navigate = useNavigate(); return <App/>; }
async function mount(route: string) {
  root?.unmount(); root = createRoot(host);
  root.render(<StrictMode><MemoryRouter initialEntries={[route]}><ToastProvider><Harness/></ToastProvider></MemoryRouter></StrictMode>);
  await delay(50);
}
async function ready(bookId: string) {
  await until(() => reader.getState().bookId === bookId && !reader.getState().isLoading && host.querySelector('[data-sentence-id]'), 'Reader did not render');
  assert(!reader.getState().loadError, reader.getState().loadError || 'Reader failed');
}
function mountedIndices() {
  return [...host.querySelectorAll('[data-chapter-index]')].filter(el => el.querySelector('[data-sentence-id]')).map(el => Number(el.getAttribute('data-chapter-index')));
}
async function fixture(count = 20, perChapter = 10, options: {version?: string; metadata?: string; nested?: boolean; missing?: boolean} = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const chapters = Math.ceil(count / perChapter);
  const items: string[] = [], refs: string[] = [];
  for (let i = 0; i < chapters; i++) {
    items.push(`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`); refs.push(`<itemref idref="c${i}"/>`);
    const paragraphs = Array.from({length: Math.min(perChapter, count-i*perChapter)}, (_, j) => `<p>房间安静，故事开始${i}-${j}。</p>`).join('');
    if (!options.missing || i !== chapters - 1) zip.file(`OPS/c${i}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter ${i+1}</title></head><body>${options.nested ? `<div>前言。${paragraphs}<div>后记。</div></div>` : paragraphs}</body></html>`);
  }
  zip.file('OPS/book.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="${options.version || '2.0'}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${options.metadata ?? '<dc:title>Regression fixture</dc:title><dc:creator>Local test</dc:creator>'}</metadata><manifest>${items.join('')}</manifest><spine>${refs.join('')}</spine></package>`);
  return new File([await zip.generateAsync({type:'arraybuffer'})], 'regression.epub', {type:'application/epub+zip'});
}
async function imported(file: File) { const id = await importBook(file); owned.add(id); return id; }
async function remove(id: string) { assert(owned.has(id), 'Refusing deletion of non-test book'); await deleteBook(id); }
async function bookmark(id: string, sentenceIndex = 0) {
  const book = (await db.books.get(id))!;
  const chapter = (await db.chapters.where('bookId').equals(id).sortBy('index'))[0]!;
  const sentence = (await db.sentences.where('chapterId').equals(chapter.id).sortBy('index'))[sentenceIndex]!;
  await toggleBookmark(id, book.title, chapter.id, chapter.title, chapter.index, sentence.id, sentence.chineseText);
  return sentence;
}

async function migration() {
  if (await Dexie.exists('ChineseReaderDB')) {
    await db.open();
    const row=await db.bookmarks.where('sentenceId').equals('migration-sentence').first();
    assert(row?.id==='migration-bookmark'&&row.createdAt===123,'Existing controlled migration row changed');
    assert(await db.bookmarks.orderBy('createdAt').count()===1,'createdAt migration/query failed');
    return {to:db.verno,existingControlledDatabase:true,bookmarkPreserved:true,sentenceIdQuery:true,createdAtQuery:true};
  }
  const old = new Dexie('ChineseReaderDB');
  old.version(1).stores({books:'id, importStatus, lastOpenedAt, createdAt', chapters:'id, bookId, [bookId+index]', sentences:'id, chapterId, bookId, [chapterId+index], [bookId+chapterId]', vocabularyItems:'id, sourceBookId, word, addedAt', bookmarks:'id, bookId, [bookId+chapterIndex]', dictionaryCache:'word, cachedAt'});
  await old.open();
  await old.table('books').add({id:'migration-book',title:'Migration fixture'});
  await old.table('chapters').add({id:'migration-chapter',bookId:'migration-book',index:0});
  await old.table('sentences').add({id:'migration-sentence',bookId:'migration-book',chapterId:'migration-chapter',index:0,chineseText:'你好。'});
  const row = {id:'migration-bookmark',bookId:'migration-book',chapterIndex:0,sentenceId:'migration-sentence',createdAt:123};
  await old.table('bookmarks').add(row);
  let oldQueryFailed = false;
  try { await old.table('bookmarks').where('sentenceId').equals(row.sentenceId).count(); } catch { oldQueryFailed = true; }
  assert(oldQueryFailed, 'v1 should lack sentenceId index');
  old.close(); // No delete/recreate: current app opens and upgrades the same database.
  await db.open();
  const migrated = await db.bookmarks.where('sentenceId').equals(row.sentenceId).first();
  assert(JSON.stringify(migrated) === JSON.stringify(row), 'Bookmark changed during migration');
  const counts = await Promise.all([db.books.count(),db.chapters.count(),db.sentences.count(),db.bookmarks.count()]);
  assert(counts.every(n=>n===1), 'Migration lost rows');
  return {from:1,to:db.verno,counts,bookmarkPreserved:true,sentenceIdQuery:true};
}

async function interruptedImportMigration() {
  assert(!await Dexie.exists('ChineseReaderDB'),'Recovery test requires a fresh origin');
  const old = new Dexie('ChineseReaderDB');
  old.version(3).stores({books:'id, importStatus, lastOpenedAt, createdAt', chapters:'id, bookId, [bookId+index]', sentences:'id, chapterId, bookId, [chapterId+index], [bookId+chapterId]', vocabularyItems:'id, sourceBookId, word, addedAt', bookmarks:'id, bookId, [bookId+chapterIndex], sentenceId, createdAt', dictionaryCache:'word, cachedAt'});
  await old.open();
  const bookBase={title:'fixture',author:'test',coverUrl:null,sourceFormat:'epub',fileSizeBytes:1,translationProgress:0,readingProgress:0,lastReadSentenceId:null,lastReadChapterIndex:0,lastOpenedAt:null,createdAt:1,chapterCount:1};
  await old.table('books').bulkAdd([
    {...bookBase,id:'ready-book',importStatus:'ready_to_read'},
    {...bookBase,id:'abandoned-book',importStatus:'processing',chapterCount:0},
  ]);
  await old.table('chapters').add({id:'abandoned-chapter',bookId:'abandoned-book',index:0,title:'partial',sentenceCount:1});
  await old.table('sentences').add({id:'abandoned-sentence',bookId:'abandoned-book',chapterId:'abandoned-chapter',index:0,chineseText:'残留。',vietnameseText:null,translationStatus:'not_translated'});
  await old.table('bookmarks').add({id:'abandoned-bookmark',bookId:'abandoned-book',bookTitle:'fixture',chapterId:'abandoned-chapter',chapterTitle:'partial',chapterIndex:0,sentenceId:'abandoned-sentence',previewText:'残留。',createdAt:1});
  await old.table('vocabularyItems').add({id:'preserved-vocabulary',word:'残留',pinyin:'',meaning:'kept',partOfSpeech:null,sourceBookId:'abandoned-book',sourceBookTitle:'fixture',sourceBookAvailable:true,sourceSentenceId:'abandoned-sentence',isKnown:false,addedAt:1});
  old.close();

  await db.open();
  assert(await db.books.get('ready-book'),'Ready book removed by recovery');
  assert(!await db.books.get('abandoned-book'),'Abandoned import survived v4 recovery');
  assert(!await db.chapters.get('abandoned-chapter')&&!await db.sentences.get('abandoned-sentence')&&!await db.bookmarks.get('abandoned-bookmark'),'Partial book-scoped rows survived recovery');
  const vocabularyRow=await db.vocabularyItems.get('preserved-vocabulary');
  assert(vocabularyRow&&!vocabularyRow.sourceBookAvailable,'Vocabulary was removed or still points to a missing source');
  return {from:3,to:db.verno,readyBookPreserved:true,abandonedImportRemoved:true,partialRowsRemoved:true,vocabularyPreserved:true,vocabularyDetached:true};
}

async function realEpub() {
  const bytes = await (await fetch('/' + encodeURIComponent('蛊真人 - 蛊真人.epub'))).arrayBuffer();
  const zip = await JSZip.loadAsync(bytes), parser = new DOMParser();
  const container = parser.parseFromString(await zip.file('META-INF/container.xml')!.async('text'),'application/xml');
  const path = container.getElementsByTagNameNS('*','rootfile')[0]!.getAttribute('full-path')!;
  const opf = parser.parseFromString(await zip.file(path)!.async('text'),'application/xml');
  const items = [...opf.getElementsByTagNameNS('*','item')], refs = [...opf.getElementsByTagNameNS('*','itemref')];
  const readable: string[] = [], empty: string[] = [], missing: string[] = [];
  for (const ref of refs) {
    const item = items.find(item=>item.id === ref.getAttribute('idref'));
    if (!item) { missing.push(ref.getAttribute('idref')!); continue; }
    if (!/html|xml/.test(item.getAttribute('media-type') || '')) continue;
    const fullPath = new URL(item.getAttribute('href')!, 'https://fixture.invalid/'+path).pathname.slice(1);
    const entry = zip.file(decodeURIComponent(fullPath));
    if (!entry) { missing.push(fullPath); continue; }
    const doc = parser.parseFromString(await entry.async('text'), 'text/html');
    if (doc.body.textContent?.trim()) readable.push(fullPath); else empty.push(fullPath);
  }
  const start = performance.now();
  const parsed = await parseEpub(bytes);
  const parsedSentences = parsed.chapters.reduce((n,ch)=>n+splitChineseSentences(ch.textContent).length,0);
  const records = await db.books.toArray();
  log('Real EPUB structure','INFO',{title:parsed.title,manifest:items.length,spine:refs.length,readableDocuments:readable.length,emptyDocuments:empty,missing,parsedChapters:parsed.chapters.length,parsedSentences,records:records.map(({id,title,importStatus,chapterCount})=>({id,title,importStatus,chapterCount}))});
  let book = records.find(book=>book.title===parsed.title && book.importStatus==='ready_to_read');
  const importStart=performance.now();
  if(!book) {
    const status=document.createElement('pre');status.id='import-status';output.after(status);
    const id=await importBook(new File([bytes],'蛊真人 - 蛊真人.epub'),progress=>{status.textContent=JSON.stringify(progress);});
    book=(await db.books.get(id))!;
  }
  const importMs=Math.round(performance.now()-importStart);
  const persistedChapters = await db.chapters.where('bookId').equals(book.id).count();
  const persistedSentences = await db.sentences.where('bookId').equals(book.id).count();
  assert(parsed.chapters.length===persistedChapters && parsedSentences===persistedSentences,'Parser/database mismatch');
  localStorage.setItem('reader-mode','chinese_only');
  await mount(`/reader/${book.id}`); await ready(book.id);
  await until(()=> mountedIndices().length === Math.min(2,persistedChapters),'Reader neighbor not loaded');
  const initialVisible=mountedIndices(),initialSentenceNodes=host.querySelectorAll('[data-sentence-id]').length;
  const samples=[];
  for(const index of [Math.floor(persistedChapters/2),persistedChapters-1]) {
    reader.getState().jumpToLocation(index);await until(()=>reader.getState().jumpTargetChapterIndex===null&&mountedIndices().includes(index),'Real book chapter jump failed');
    assert(mountedIndices().every(i=>Math.abs(i-index)<=1),'Real book mounted distant content');
    samples.push({chapterIndex:index,mounted:mountedIndices(),sentenceNodes:host.querySelectorAll('[data-sentence-id]').length,domNodes:host.querySelectorAll('*').length});
  }
  return {bookId:book.id,title:parsed.title,author:parsed.author,manifest:items.length,spine:refs.length,readableDocuments:readable.length,emptyDocuments:empty,missing,parsedChapters:parsed.chapters.length,parsedSentences,persistedChapters,persistedSentences,readerVisibleChapters:initialVisible,readerSentenceNodes:initialSentenceNodes,samples,importMs,parseAndReaderMs:Math.round(performance.now()-start)};
}

async function suite() {
  await test('EPUB2 / EPUB3 / missing metadata / corrupt',async()=>{
    for (const version of ['2.0','3.0']) { const p=await parseEpub(await (await fixture(20,10,{version})).arrayBuffer()); assert(p.chapters.length===2,'Spine order/count'); assert(p.chapters[1]!.textContent.includes('1-0'),'Wrong spine order'); }
    const missing=await parseEpub(await (await fixture(2,10,{metadata:''})).arrayBuffer()); assert(missing.title==='Untitled'&&missing.author==='Unknown Author','Metadata fallback');
    let rejected=false; try {await parseEpub(new ArrayBuffer(10));} catch {rejected=true;} assert(rejected,'Corrupt ZIP accepted');
  });
  await test('Nested blocks extracted once',async()=>{
    const p=await parseEpub(await (await fixture(2,10,{nested:true})).arrayBuffer());
    assert(splitChineseSentences(p.chapters[0]!.textContent).length===4,'Nested blocks duplicate text');
  });
  await test('Missing spine document rejects partial import',async()=>{
    let rejected=false; try {await parseEpub(await (await fixture(20,10,{missing:true})).arrayBuffer());} catch {rejected=true;} assert(rejected,'Missing document silently discarded');
  });
  await test('Import progress remains active while clearing error',async()=>{
    library.getState().setIsImporting(true); library.getState().setImportError(null); assert(library.getState().isImporting,'Clearing error cancels importing UI'); library.getState().resetImportState();
  });
  await test('Failed/interrupted new import leaves no database record',async()=>{
    const before=await db.books.count();
    let rejected=false;
    try { await importBook(new File(['not-a-zip'],'interrupted.epub')); } catch { rejected=true; }
    assert(rejected,'Invalid import unexpectedly succeeded');
    assert(await db.books.count()===before,'Failed import left a zero-chapter/transient book');
  });
  const id=await imported(await fixture(30));
  await test('Fresh import / bookmarks add-remove / indexed list',async()=>{
    assert(await db.chapters.where('bookId').equals(id).count()===3,'Chapters count');
    assert(await db.sentences.where('bookId').equals(id).count()===30,'Sentence count');
    const s=await bookmark(id); assert(await db.bookmarks.where('sentenceId').equals(s.id).count()===1,'Bookmark add');
    await bookmark(id); assert(await db.bookmarks.where('sentenceId').equals(s.id).count()===0,'Bookmark remove');
    await bookmark(id); await db.bookmarks.orderBy('createdAt').reverse().toArray();
  });
  await test('Cancelled Reader init preserves progress',async()=>{
    const chapter=(await db.chapters.where('bookId').equals(id).sortBy('index'))[2]!;
    const s=(await db.sentences.where('chapterId').equals(chapter.id).first())!;
    await db.books.update(id,{lastReadChapterIndex:2,lastReadSentenceId:s.id,readingProgress:70});
    const pending=reader.getState().initializeReader(id); reader.getState().cleanup(); await pending; await delay(100);
    assert((await db.books.get(id))!.lastReadSentenceId===s.id,'Cleanup overwrote persisted resume with null');
  });
  await test('Valid replace / corrupt replace preserves original',async()=>{
    const before=await db.books.get(id), count=await db.sentences.where('bookId').equals(id).count();
    let rejected=false; try {await replaceBook(id,new File(['bad'],'bad.epub'));} catch {rejected=true;}
    assert(rejected&&JSON.stringify(await db.books.get(id))===JSON.stringify(before),'Corrupt replacement changed book'); assert(await db.sentences.where('bookId').equals(id).count()===count,'Corrupt replacement lost sentences');
    await replaceBook(id,await fixture(15)); assert(await db.sentences.where('bookId').equals(id).count()===15,'Replacement count'); assert(await db.bookmarks.where('bookId').equals(id).count()===0,'Old bookmarks remain'); assert((await db.books.get(id))!.readingProgress===0,'Progress not reset');
  });
  await test('Delete cascade preserves vocabulary',async()=>{
    const s=await bookmark(id); await db.sentences.update(s.id,{vietnameseText:'Cached',translationStatus:'ready'});
    await vocabulary.getState().addWord('fixture-'+id,'pinyin','meaning',null,id,'Test',s.id);
    await remove(id);
    for(const table of [db.chapters,db.sentences,db.bookmarks]) assert(await table.where('bookId').equals(id).count()===0,'Cascade left child records');
    assert(!await db.books.get(id),'Book remains'); const v=await db.vocabularyItems.where('sourceBookId').equals(id).first(); assert(v&&!v.sourceBookAvailable,'Vocabulary lost/not detached');
  });
  await test('Translation delete/replace races ignore abort-ignoring provider',async()=>{
    const original=translationProvider.translate;
    try {
      for(const operation of ['delete','replace']) {
        const raceId=await imported(await fixture(2)); let resolve!: (text:string)=>void;
        translationProvider.translate=()=>new Promise(r=>{resolve=r;});
        const s=(await db.sentences.where('bookId').equals(raceId).first())!;
        translationQueue.enqueue(s); await until(()=>resolve,'Provider did not start');
        if(operation==='delete') await remove(raceId); else await replaceBook(raceId,await fixture(3));
        resolve('Late result'); await delay(100); assert(!await db.sentences.get(s.id),'Old sentence resurrected');
        const remaining=await db.sentences.where('bookId').equals(raceId).toArray(); assert(remaining.every(s=>s.vietnameseText===null),'Old translation contaminated replacement');
      }
    } finally {translationProvider.translate=original;}
  });
  await test('Translation cached / duplicate / failure / interrupted recovery',async()=>{
    const tid=await imported(await fixture(3)), sentences=await db.sentences.where('bookId').equals(tid).toArray(); const original=translationProvider.translate; let calls=0;
    try {
      translationProvider.translate=async()=>{calls++;await delay(50);return 'Translation';};
      await db.sentences.update(sentences[0]!.id,{translationStatus:'ready',vietnameseText:'Cache'}); translationQueue.enqueue(sentences[0]!); await delay(100); assert(calls===0,'Cached sentence called provider');
      for(let i=0;i<5;i++)translationQueue.enqueue(sentences[1]!);
      await until(async()=>(await db.sentences.get(sentences[1]!.id))!.translationStatus==='ready','Not translated'); assert(Number(calls)===1,'Duplicate provider requests');
      translationProvider.translate=async()=>{throw new Error('503');}; translationQueue.enqueue(sentences[2]!); await until(async()=>(await db.sentences.get(sentences[2]!.id))!.translationStatus==='failed','Failure not persisted');
      await db.sentences.update(sentences[2]!.id,{translationStatus:'translating'});translationProvider.translate=async()=> 'Recovered';translationQueue.enqueue((await db.sentences.get(sentences[2]!.id))!);
      await until(async()=>(await db.sentences.get(sentences[2]!.id))!.translationStatus==='ready','Persisted translating sentence stuck after restart',1500);
    } finally {translationProvider.translate=original;}
  });
  await test('Dictionary hover A-B-C zero network / click A-B-C latest wins',async()=>{
    const original=window.fetch; let requests=0;window.fetch=async()=>{requests++;throw new Error('External request forbidden');};
    try {
      for(const word of ['房间','安静','unknown-hover'])dictionary.getState().handleWordHover(word,{x:0,y:0,height:10});
      await delay(250); assert(dictionary.getState().hoveredWord==='unknown-hover','Stale hover response');assert(requests===0,'Hover called network');
      const words=['race-A','race-B','race-C'].map(w=>w+Date.now()); await Promise.all(words.map(w=>dictionary.getState().handleWordClick(w)));assert(dictionary.getState().panelWord===words[2]&&dictionary.getState().panelResult?.word===words[2],'Stale click response');
    } finally {window.fetch=original;dictionary.getState().handleWordLeave();dictionary.getState().closePanel();}
  });
  await test('API provider 429/5xx/malformed response',async()=>{
    const original=window.fetch;const provider=new ApiTranslationProvider();
    try { for (const response of [new Response('{}',{status:429}),new Response('{}',{status:503}),new Response('{}'),new Response('{')]) {
      window.fetch=async()=>response;let failed=false;try{await provider.translate('你好');}catch{failed=true;}assert(failed,'Bad API response accepted');
    }}finally{window.fetch=original;}
  });
}

async function large() {
  localStorage.setItem('reader-mode','chinese_only');
  for(const count of [1000,5000,10000]) await test(`Large book ${count}`,async()=>{
    const start=performance.now(), id=await imported(await fixture(count,100));const importMs=Math.round(performance.now()-start);
    const renderStart=performance.now();await mount(`/reader/${id}`);await ready(id);await until(()=>mountedIndices().length===2,'Initial neighbor not mounted');
    const renderMs=Math.round(performance.now()-renderStart);const target=Math.floor(count/100/2);
    const switchStart=performance.now();reader.getState().jumpToLocation(target);await until(()=>mountedIndices().includes(target+1)&&reader.getState().jumpTargetChapterIndex===null,'Chapter transition incomplete');await delay(200);
    const switchMs=Math.round(performance.now()-switchStart);
    const indices=mountedIndices(),sentenceNodes=host.querySelectorAll('[data-sentence-id]').length,domNodes=host.querySelectorAll('*').length;
    assert(indices.every(i=>Math.abs(i-reader.getState().currentChapterIndex)<=1)&&indices.length<=3,'Distant chapter sentence DOM remains');assert(sentenceNodes<=300,'Too much mounted sentence content');
    reader.getState().setReadingSize('XXL');reader.getState().setLineHeightMultiplier(1.5);await delay(100);assert(!host.textContent?.includes('NaN%'),'NaN progress');
    const first=host.querySelector<HTMLElement>('[data-sentence-id]')!;first.scrollIntoView();await delay(200);
    await Promise.all([reader.getState().initializeReader(id),reader.getState().initializeReader('invalid-id'),reader.getState().initializeReader(id)]);assert(reader.getState().bookId===id&&!reader.getState().loadError,'Rapid route stale state');
    return {count,chapters:count/100,importMs,renderMs,switchMs,mountedIndices:indices,sentenceNodes,domNodes,runtimeCachedChapters:Object.keys(reader.getState().chapterSentences).length};
  });
}

async function ui() {
  localStorage.setItem('reader-mode','chinese_only');
  const id=await imported(await fixture(1000,100));
  await test('Actual ImportModal progress / success',async()=>{
    await mount('/');library.getState().openImportModal();await until(()=>document.querySelector('input[type=file]'),'No file input');
    const input=document.querySelector<HTMLInputElement>('input[type=file]')!,data=new DataTransfer();data.items.add(await fixture(30));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    await until(()=>document.body.textContent?.includes('Sách đã sẵn sàng!'),'Import success UI missing');
    assert(library.getState().importedBookId,'No imported book id');owned.add(library.getState().importedBookId!);library.getState().closeImportModal();
  });
  await test('Bookmark button works before first scroll',async()=>{
    await mount(`/reader/${id}`);await ready(id);await delay(100);
    host.querySelector<HTMLButtonElement>('[aria-label="Bookmark"]')!.click();
    await until(()=>db.bookmarks.where('bookId').equals(id).count(),'Initial bookmark click did nothing',1000);
  });
  await test('Virtualization height includes chapter padding/border',async()=>{
    await delay(100);
    for(const el of host.querySelectorAll<HTMLElement>('[data-chapter-index][data-chapter-id]')) {
      const stored=reader.getState().chapterHeights[el.dataset.chapterId!];
      assert(Math.abs((stored??0)-el.getBoundingClientRect().height)<2,`Height mismatch: stored=${stored}, actual=${el.getBoundingClientRect().height}`);
    }
  });
  await test('/bookmarks click jumps to correct sentence',async()=>{
    const s=await bookmark(id,50);navigate('/bookmarks');await until(()=>host.querySelector('h1')?.textContent==='Bookmarks'&&host.textContent?.includes(s.chineseText),'Bookmark list not rendered');
    const preview=[...host.querySelectorAll<HTMLElement>('div')].find(el=>el.textContent===s.chineseText && el.children.length===0)!;assert(preview,'No bookmark preview');preview.click();
    await ready(id);await until(()=>reader.getState().jumpTargetChapterIndex===null&&host.querySelector(`[data-sentence-id="${s.id}"]`),'Jump not completed');await delay(200);
    const target=host.querySelector<HTMLElement>(`[data-sentence-id="${s.id}"]`)!;
    const scroller=host.querySelector<HTMLElement>('[class*="scrollContainer"]')!;
    assert(Math.abs(target.getBoundingClientRect().top-scroller.getBoundingClientRect().top)<160,'Bookmark target not in view');
  });
  await test('Dictionary result after Reader exit must stay closed',async()=>{
    await mount(`/reader/${id}`);await ready(id);
    const pending=dictionary.getState().handleWordClick('navigate-test-'+Date.now());navigate('/');await delay(50);await pending;
    assert(!dictionary.getState().isPanelOpen,'Old panel survives Reader navigation');
  });
  await test('Invalid Reader and deleted-book detail routes show errors',async()=>{
    await mount('/reader/invalid-book');await until(()=>host.textContent?.includes('Sách không tìm thấy'),'Missing Reader error');
    navigate('/book/invalid-book');await until(()=>host.querySelector('h1')?.textContent==='Thư viện','Missing book detail stays loading',1200);
  });
  await test('Rapid route changes use latest Reader only',async()=>{
    await mount(`/reader/${id}`);await ready(id);
    navigate('/reader/not-found');await delay(1);navigate(`/reader/${id}`);await delay(1);navigate('/reader/deleted');await until(()=>reader.getState().bookId==='deleted'&&!reader.getState().isLoading,'Latest route not settled');assert(reader.getState().loadError,'Older book overwrote missing route');
  });
  await test('Direct URL / full reload / resume / settings persistence',async()=>{
    root?.unmount();root=undefined;
    const chapter=(await db.chapters.where('bookId').equals(id).sortBy('index'))[5]!;
    const s=(await db.sentences.where('chapterId').equals(chapter.id).sortBy('index'))[40]!;
    await db.books.update(id,{lastReadChapterIndex:5,lastReadSentenceId:s.id,readingProgress:55});
    reader.getState().setReadingSize('XXL');reader.getState().setLineHeightMultiplier(1.5);useAppStore.getState().setTheme('dark');
    const frame=document.createElement('iframe');frame.width='1400';frame.height='800';host.replaceChildren(frame);
    try{
      frame.src=`/reader/${id}`;await until(()=>frame.contentDocument?.querySelector(`[data-sentence-id="${s.id}"]`),'Direct Reader URL not loaded');await delay(300);
      const inView=()=>{const doc=frame.contentDocument!,target=doc.querySelector(`[data-sentence-id="${s.id}"]`)!,scroller=doc.querySelector('[class*="scrollContainer"]')!;return Math.abs(target.getBoundingClientRect().top-scroller.getBoundingClientRect().top)<160;};
      if(!inView()) {
        const doc=frame.contentDocument!,target=doc.querySelector(`[data-sentence-id="${s.id}"]`)!,scroller=doc.querySelector('[class*="scrollContainer"]')!;
        log('Resume geometry','INFO',{targetTop:target.getBoundingClientRect().top,scrollerTop:scroller.getBoundingClientRect().top,scrollTop:scroller.scrollTop,persisted:await db.books.get(id)});
      }
      assert(inView(),'Direct URL failed resume');
      frame.contentWindow!.location.reload();await delay(100);await until(()=>frame.contentDocument?.querySelector(`[data-sentence-id="${s.id}"]`),'Reload lost Reader');await delay(300);assert(inView(),'Reload lost resume');
      const doc=frame.contentDocument!;assert(doc.querySelector<HTMLElement>('[class*="scrollContainer"]')!.style.getPropertyValue('--reading-cn-size')==='28px','Reading size not persistent');assert(doc.documentElement.getAttribute('data-theme')==='dark','Theme not persistent');assert(!doc.body.textContent?.includes('NaN%'),'NaN progress');
    } finally{frame.remove();}
  });
}

async function stateRaces() {
  const id=await imported(await fixture(1000,20));
  await test('Rapid chapter preloads cannot refill distant runtime cache',async()=>{
    await reader.getState().initializeReader(id);
    for(let i=3;i<48;i+=3)reader.getState().setCurrentChapter(i);
    await until(()=>reader.getState().loadingChapterIds.length===0,'Preload did not settle');
    const state=reader.getState(),indices=Object.keys(state.chapterSentences).map(id=>state.chapters.findIndex(ch=>ch.id===id));
    assert(indices.every(i=>Math.abs(i-state.currentChapterIndex)<=2),`Distant loaded chapters: ${indices.join(',')}`);return {cachedChapterIndices:indices};
  });
  await test('Concurrent bookmark toggles serialize without duplicate rows',async()=>{
    const s=await bookmark(id);await bookmark(id);
    await Promise.all([bookmark(id),bookmark(id)]);assert(await db.bookmarks.where('sentenceId').equals(s.id).count()===0,'Concurrent toggles inserted duplicate bookmarks');
  });
  await test('Translation concurrency never exceeds three',async()=>{
    const original=translationProvider.translate;let active=0,maxActive=0,calls=0;
    try{
      translationProvider.translate=async()=>{calls++;active++;maxActive=Math.max(maxActive,active);await delay(30);active--;return 'Translation';};
      const sentences=await db.sentences.where('bookId').equals(id).limit(12).toArray();sentences.forEach(sentence=>translationQueue.enqueue(sentence));
      await until(async()=> (await db.sentences.bulkGet(sentences.map(s=>s.id))).every(s=>s?.translationStatus==='ready'),'Queue not drained');
      assert(maxActive===3&&calls===12,'Concurrency/dedup regression');return{maxActive,calls};
    }finally{translationProvider.translate=original;reader.getState().cleanup();}
  });
}

async function api() {
  const original=window.fetch;
  const response=(word:string)=>({word,pinyin:null,meaning:'meaning',partOfSpeech:null,examples:[],relatedWords:[],source:'external',completeness:'complete',fetchedAt:Date.now()});
  try {
    await test('Real-mode hover zero requests and click race/dedup/cache',async()=>{
      let requests=0;
      window.fetch=async(_url,init)=>{requests++;const {word}=JSON.parse(String(init!.body));await delay(word.includes('A')?150:word.includes('B')?100:20);return Response.json(response(word));};
      const stamp=Date.now(),words=['A','B','C'].map(w=>'api-race-'+w+stamp);
      for(const word of words)dictionary.getState().handleWordHover(word,{x:0,y:0,height:5});await delay(250);assert(requests===0,'Hover requested external API');
      await Promise.all(words.map(word=>dictionary.getState().handleWordClick(word)));assert(dictionary.getState().panelResult?.word===words[2],'Stale external response overwrote newest');assert(Number(requests)===3,'Unexpected request count');
      await lookupWord(words[2]!,true);assert(Number(requests)===3,'Persistent cache missed');
      const same='dedup-'+stamp;await Promise.all([lookupWord(same,true),lookupWord(same,true)]);assert(Number(requests)===4,'Concurrent same-word duplicate request');return {hoverRequests:0,clickRequests:3,dedupRequests:1};
    });
    await test('Dictionary rejects malformed nested response',async()=>{
      window.fetch=async()=>Response.json({...response('bad-'+Date.now()),meaning:{bad:'object'},examples:[{chinese:{bad:true},vietnamese:12}],relatedWords:[null]});
      let rejected=false;try{await lookupWord('bad-'+Date.now(),true);}catch{rejected=true;}assert(rejected,'Malformed dictionary payload reaches React render');
    });
    await test('Dictionary 429 / 5xx / network failure surfaces error',async()=>{
      for(const status of [429,503,0]){window.fetch=async()=>{if(!status)throw new TypeError('offline');return new Response('{}',{status});};await dictionary.getState().handleWordClick('fail-'+status+'-'+Date.now());assert(dictionary.getState().panelState==='error','Dictionary failure not isolated');}
    });
    await test('Dictionary timeout covers stalled JSON body',async()=>{
      window.fetch=async(_url,init)=>({ok:true,json:()=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}))}) as Response;
      const start=performance.now();const result=await Promise.race([lookupWord('timeout-'+Date.now(),true).then(()=> 'accepted',()=> 'timeout'),delay(11500).then(()=> 'hung')]);assert(result==='timeout','Dictionary body hung beyond timeout');return {elapsedMs:Math.round(performance.now()-start)};
    });
    await test('API translation timeout and already-aborted cancellation',async()=>{
      const provider=new ApiTranslationProvider();let requests=0;
      window.fetch=async(_url,init)=>new Promise((_resolve,reject)=>{requests++;if(init!.signal!.aborted)reject(init!.signal!.reason);else init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});});
      const cancelled=new AbortController();cancelled.abort();const start=performance.now();try{await provider.translate('你好',cancelled.signal);}catch{}assert(performance.now()-start<500,'Already-aborted request waited for timeout');
      const result=await Promise.race([provider.translate('你好').then(()=>false,()=>true),delay(11500).then(()=>false)]);assert(result,'Translation request hung');return {requests};
    });
    await test('API translation rejects blank successful response',async()=>{
      window.fetch=async()=>Response.json({translation:'  '});let rejected=false;try{await new ApiTranslationProvider().translate('你好');}catch{rejected=true;}assert(rejected,'Empty translation accepted as ready');
    });
  } finally{window.fetch=original;dictionary.getState().handleWordLeave();dictionary.getState().closePanel();}
}

document.querySelector<HTMLButtonElement>('#run')!.onclick=async(event)=>{
  const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
  try {
    assert(['127.0.0.1','localhost'].includes(location.hostname),'Local only');
    const group=new URLSearchParams(location.search).get('suite');
    assert(group==='api' ? import.meta.env.VITE_USE_MOCK_API==='false' : import.meta.env.VITE_USE_MOCK_API==='true','Use the documented mock/real test mode');
    if(group==='api') await api();
    else if(group==='migration') await test('v1 bookmark migration',migration);
    else if(group==='recovery') await test('Interrupted import migration',interruptedImportMigration);
    else if(group==='real') await test('Real EPUB pipeline',realEpub);
    else if(group==='large') await large();
    else if(group==='ui') await ui();
    else if(group==='races') await stateRaces();
    else await suite();
  } catch(error){log('Runner','FAIL',String(error));}
  finally {log('DONE','INFO',{tests:results.length});button.disabled=false;}
};
document.querySelector<HTMLButtonElement>('#run')!.disabled=false;
