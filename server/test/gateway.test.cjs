const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const base='http://127.0.0.1:5199';
let child;
let logs='';
before(async()=>{
  child=spawn(process.execPath,['--require',path.join(__dirname,'provider-transport.cjs'),path.join(__dirname,'../index.js')],{
    cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'5199',TRANSLATION_PROVIDER:'google-free',DICTIONARY_PROVIDER:'mock',FRONTEND_URL:'http://localhost:5185'},windowsHide:true,stdio:['ignore','pipe','pipe']
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
test('health',async()=>{const response=await fetch(base+'/api/health');assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok'});});
test('translate through actual adapter / gateway',async()=>{const r=await post('/api/translate',{text:'你好',sourceLanguage:'zh-CN',targetLanguage:'vi'});assert.equal(r.status,200);assert.equal((await r.json()).translation,'Bản dịch thử nghiệm');});
test('dictionary',async()=>{const r=await post('/api/dictionary',{word:'你好'});assert.equal(r.status,200);assert.equal((await r.json()).word,'你好');});
test('blank / wrong type / invalid languages',async()=>{
  for(const body of [{},{text:' '},{text:12},{text:'你好',sourceLanguage:12},{text:'你好',targetLanguage:'bad&value'},{text:'x'.repeat(501)}])assert.equal((await post('/api/translate',body)).status,400);
  for(const body of [{},{word:' '},{word:[]},{word:'x'.repeat(51)}])assert.equal((await post('/api/dictionary',body)).status,400);
});
test('empty HTTP body returns client error, not 500',async()=>{
  for(const endpoint of ['/api/translate','/api/dictionary'])assert.equal((await post(endpoint,undefined,{})).status,400);
});
test('malformed JSON and body size have JSON errors with CORS',async()=>{
  for(const [body,status] of [['{',400],[JSON.stringify({text:'x'.repeat(11000)}),413]]) {
    const r=await post('/api/translate',body);assert.equal(r.status,status);assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:5185');assert.ok((await r.json()).error);
  }
});
test('upstream 429 / timeout / network / 5xx / malformed mapping',async()=>{
  for(const [text,status,code] of [['429',429,'RATE_LIMIT_EXCEEDED'],['timeout',504,'TRANSLATION_TIMEOUT'],['network',502,'BAD_GATEWAY'],['503',502,'BAD_GATEWAY'],['malformed',502,'BAD_GATEWAY']]) {
    const r=await post('/api/translate',{text});assert.equal(r.status,status);assert.equal((await r.json()).error,code);
  }
});
test('IP rate limit returns JSON 429',async()=>{
  let limited=false;
  for(let i=0;i<505;i++) {const r=await fetch(base+'/api/health');if(r.status===429){assert.ok((await r.json()).error);limited=true;break;}}
  assert.ok(limited);
});
test('logs omit submitted content',()=>{assert.ok(!logs.includes('你好'));assert.ok(!logs.includes('bad&value'));});
