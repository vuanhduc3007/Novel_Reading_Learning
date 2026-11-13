const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const base='http://127.0.0.1:5199';
let child;
let logs='';
before(async()=>{
  child=spawn(process.execPath,['--require',path.join(__dirname,'provider-transport.cjs'),path.join(__dirname,'../index.js')],{
    cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'5199',TRANSLATION_PROVIDER:'google-free',DICTIONARY_PROVIDER:'mymemory',FRONTEND_URL:'http://localhost:5185'},windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
  const deadline=Date.now()+10000;
  while(!logs.includes('Backend Gateway running')) {
    if(child.exitCode!==null)throw new Error('Test gateway failed to start: '+logs);
    if(Date.now()>deadline)throw new Error('Test gateway start timeout');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
});
after(()=>child?.kill());
async function post(endpoint,body,headers={'Content-Type':'application/json',Origin:'http://localhost:5185'}) {
  return fetch(base+endpoint,{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
}
async function spawnGateway(t, port, environment = {}) {
  let output='';
  const isolated=spawn(process.execPath,['--require',path.join(__dirname,'provider-transport.cjs'),path.join(__dirname,'../index.js')],{
    cwd:path.join(__dirname,'..'),
    env:{...process.env,PORT:String(port),TRANSLATION_PROVIDER:'google-free',DICTIONARY_PROVIDER:'mymemory',FRONTEND_URL:'http://localhost:5185',...environment},
    windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  t.after(()=>isolated.kill());
  isolated.stdout.on('data',chunk=>{output+=chunk;});isolated.stderr.on('data',chunk=>{output+=chunk;});
  const deadline=Date.now()+10000;
  while(!output.includes('Backend Gateway running')) {
    if(isolated.exitCode!==null)throw new Error('Isolated gateway failed to start: '+output);
    if(Date.now()>deadline)throw new Error('Isolated gateway start timeout: '+output);
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  return `http://127.0.0.1:${port}`;
}
test('health',async()=>{const response=await fetch(base+'/api/health');assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok'});});
test('translate through actual adapter / gateway',async()=>{const r=await post('/api/translate',{text:'你好',sourceLanguage:'zh-CN',targetLanguage:'vi'});assert.equal(r.status,200);assert.equal((await r.json()).translation,'Bản dịch thử nghiệm');});
test('batch translation preserves item ids/order for 5, 10 and 25 items',async()=>{
  for(const size of [5,10,25]) {
    const items=Array.from({length:size},(_,index)=>({id:`sentence-${index}`,text:`第${index+1}句。`}));
    const r=await post('/api/translate/batch',{items,sourceLanguage:'zh-CN',targetLanguage:'vi'});
    assert.equal(r.status,200);
    const body=await r.json();
    assert.deepEqual(body.results.map(item=>item.id),items.map(item=>item.id));
    assert.ok(body.results.every(item=>item.status==='translated'&&item.translation.startsWith('Bản dịch')));
    assert.equal(body.provider,'google-free');
  }
});
test('batch translation keeps partial failures itemized',async()=>{
  const items=[{id:'one',text:'第一句。'},{id:'failed',text:'partial-fail'},{id:'three',text:'第三句。'}];
  const r=await post('/api/translate/batch',{items});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.deepEqual(body.results.map(item=>item.id),items.map(item=>item.id));
  assert.equal(body.results[0].status,'translated');
  assert.equal(body.results[1].status,'failed');
  assert.equal(body.results[1].error.code,'MALFORMED_PROVIDER_RESPONSE');
  assert.equal(body.results[2].status,'translated');
});
test('batch validation enforces item and provider character limits',async()=>{
  assert.equal((await post('/api/translate/batch',{items:[]})).status,400);
  assert.equal((await post('/api/translate/batch',{items:Array.from({length:26},(_,i)=>({id:String(i),text:'句。'}))})).status,400);
  assert.equal((await post('/api/translate/batch',{items:[{id:'duplicate',text:'一。'},{id:'duplicate',text:'二。'}]})).status,400);
  const tooLarge=Array.from({length:25},(_,i)=>({id:String(i),text:'字'.repeat(101)}));
  const largeResponse=await post('/api/translate/batch',{items:tooLarge});
  assert.equal(largeResponse.status,400);
  assert.equal((await largeResponse.json()).error,'BATCH_TOO_LARGE');
});
test('rate-limited primary endpoint falls back to the secondary endpoint',async()=>{
  const r=await post('/api/translate/batch',{items:[{id:'a',text:'primary-429'},{id:'b',text:'第二句。'}]});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.deepEqual(body.results.map(item=>item.status),['translated','translated']);
  assert.match(body.results[1].translation,/fallback/);
});
test('real dictionary adapter preserves the response contract',async()=>{
  const r=await post('/api/dictionary',{word:'学习'});
  assert.equal(r.status,200);
  const result=await r.json();
  assert.deepEqual(result,{word:'学习',pinyin:'xué xí',meaning:'học tập',partOfSpeech:null,examples:[],relatedWords:[],source:'external',completeness:'partial',fetchedAt:result.fetchedAt});
  assert.ok(Number.isFinite(result.fetchedAt));
  assert.ok(!JSON.stringify(result).includes('Mock meaning'));
});
test('unknown dictionary word has a structured 404',async()=>{
  const r=await post('/api/dictionary',{word:'dictionary-unknown'});
  assert.equal(r.status,404);
  assert.deepEqual(await r.json(),{error:'DICTIONARY_NOT_FOUND',message:'Dictionary word not found'});
});
test('dictionary provider must be configured explicitly',async t=>{
  let isolatedLogs='';
  const isolated=spawn(process.execPath,['--require',path.join(__dirname,'provider-transport.cjs'),path.join(__dirname,'../index.js')],{
    cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'5200',DICTIONARY_PROVIDER:'',FRONTEND_URL:'http://localhost:5185'},windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  t.after(()=>isolated.kill());
  isolated.stdout.on('data',chunk=>{isolatedLogs+=chunk;});isolated.stderr.on('data',chunk=>{isolatedLogs+=chunk;});
  const deadline=Date.now()+10000;
  while(!isolatedLogs.includes('Backend Gateway running')) {
    if(isolated.exitCode!==null)throw new Error('Unconfigured gateway failed to start: '+isolatedLogs);
    if(Date.now()>deadline)throw new Error('Unconfigured gateway start timeout');
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  const r=await fetch('http://127.0.0.1:5200/api/dictionary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({word:'学习'})});
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:'DICTIONARY_NOT_CONFIGURED',message:'Dictionary provider is not configured'});
  assert.ok(!isolatedLogs.includes('Mock meaning'));
});
test('blank / wrong type / invalid languages',async()=>{
  for(const body of [{},{text:' '},{text:12},{text:'你好',sourceLanguage:12},{text:'你好',targetLanguage:'bad&value'},{text:'x'.repeat(501)}])assert.equal((await post('/api/translate',body)).status,400);
  for(const body of [{},{word:' '},{word:[]},{word:'x'.repeat(51)}])assert.equal((await post('/api/dictionary',body)).status,400);
});
test('empty HTTP body returns client error, not 500',async()=>{
  for(const endpoint of ['/api/translate','/api/dictionary'])assert.equal((await post(endpoint,undefined,{})).status,400);
});
test('malformed JSON and body size have JSON errors with CORS',async()=>{
  for(const [body,status] of [['{',400],[JSON.stringify({text:'x'.repeat(70000)}),413]]) {
    const r=await post('/api/translate',body);assert.equal(r.status,status);assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:5185');assert.ok((await r.json()).error);
  }
});
test('upstream 429 / timeout / network / 5xx / malformed mapping',async()=>{
  for(const [text,status,code] of [['429',429,'RATE_LIMIT_EXCEEDED'],['timeout',504,'TRANSLATION_TIMEOUT'],['network',502,'BAD_GATEWAY'],['503',502,'BAD_GATEWAY'],['malformed',502,'BAD_GATEWAY']]) {
    const r=await post('/api/translate',{text});assert.equal(r.status,status);assert.equal((await r.json()).error,code);
  }
  for(const [word,status,code] of [['dictionary-429',429,'RATE_LIMIT_EXCEEDED'],['dictionary-timeout',504,'DICTIONARY_TIMEOUT'],['dictionary-network',502,'BAD_GATEWAY'],['dictionary-503',502,'BAD_GATEWAY'],['dictionary-malformed',502,'BAD_GATEWAY']]) {
    const r=await post('/api/dictionary',{word});assert.equal(r.status,status);assert.equal((await r.json()).error,code);
  }
});
test('translation/dictionary limits are separate and health consumes neither',async t=>{
  const isolated=await spawnGateway(t,5201,{TRANSLATION_RATE_LIMIT_MAX:'2',DICTIONARY_RATE_LIMIT_MAX:'1',RENDER:'true'});
  const headers={'Content-Type':'application/json','X-Forwarded-For':'203.0.113.10'};
  for(let i=0;i<5;i++)assert.equal((await fetch(isolated+'/api/health',{headers})).status,200);
  assert.equal((await fetch(isolated+'/api/dictionary',{method:'POST',headers,body:'{}'})).status,400);
  const dictionaryLimited=await fetch(isolated+'/api/dictionary',{method:'POST',headers,body:'{}'});
  assert.equal(dictionaryLimited.status,429);
  assert.equal((await dictionaryLimited.json()).error,'APP_RATE_LIMIT');
  assert.equal((await fetch(isolated+'/api/translate',{method:'POST',headers,body:'{}'})).status,400);
  assert.equal((await fetch(isolated+'/api/translate',{method:'POST',headers,body:'{}'})).status,400);
  const translationLimited=await fetch(isolated+'/api/translate',{method:'POST',headers,body:'{}'});
  assert.equal(translationLimited.status,429);
  assert.equal((await translationLimited.json()).error,'APP_RATE_LIMIT');
  assert.ok(translationLimited.headers.get('retry-after'));
  const otherClient={...headers,'X-Forwarded-For':'203.0.113.11'};
  assert.equal((await fetch(isolated+'/api/translate',{method:'POST',headers:otherClient,body:'{}'})).status,400);
});
test('501st translation request receives the structured application limit',async t=>{
  const isolated=await spawnGateway(t,5202);
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
  for(let i=0;i<500;i++)assert.equal((await fetch(isolated+'/api/translate',options)).status,400);
  const limited=await fetch(isolated+'/api/translate',options);
  assert.equal(limited.status,429);
  const body=await limited.json();
  assert.equal(body.error,'APP_RATE_LIMIT');
  assert.ok(body.retryAfterSeconds>0);
});
test('logs omit submitted content',()=>{assert.ok(!logs.includes('学习'));assert.ok(!logs.includes('bad&value'));assert.ok(!logs.includes('dictionary-unknown'));});
