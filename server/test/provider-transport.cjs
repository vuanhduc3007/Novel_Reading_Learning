// Test-process-only transport. Exercises the actual provider adapter without
// contacting Google or transmitting any book content outside localhost.
const axios = require('axios');
axios.defaults.adapter = async config => {
  const url = new URL(config.url);
  if (url.hostname === 'translate.googleapis.com' || url.hostname === 'clients5.google.com') {
    if (config.timeout !== 8000) throw new Error('Missing provider timeout');
    if (config.method !== 'post' || url.pathname !== '/translate_a/t') throw new Error('Unexpected translation endpoint');
    if (config.params?.sl !== 'zh-CN' || config.params?.tl !== 'vi') throw new Error('Unexpected translation languages');
    const texts = new URLSearchParams(config.data).getAll('q');
    const primary = url.hostname === 'translate.googleapis.com';
    for (const text of texts) {
      if (text === 'timeout') throw Object.assign(new Error('timeout'), {code:'ECONNABORTED'});
      if (text === 'network') throw Object.assign(new Error('offline'), {code:'ENOTFOUND'});
      if (text === '429' || text === '503' || text === 'batch-429') {
        throw Object.assign(new Error('upstream failed'), {response:{status:text === '503' ? 503 : 429}});
      }
      if (text === 'primary-429' && primary) throw Object.assign(new Error('upstream failed'), {response:{status:429}});
    }
    if (texts.includes('malformed')) return {status:200,statusText:'OK',config,headers:{},data:{bad:true}};
    const data = texts.map(text => text === 'partial-fail' ? '' : texts.length === 1 && text === '你好'
      ? 'Bản dịch thử nghiệm'
      : `Bản dịch ${text}${primary ? '' : ' (fallback)'}`);
    return {status:200, statusText:'OK', config, headers:{}, data};
  }

  if (url.hostname === 'api.mymemory.translated.net') {
    const word = config.params?.q;
    if (config.params?.langpair !== 'zh-CN|vi-VN' || config.params?.mt !== '1') {
      throw new Error('Unexpected dictionary language configuration');
    }
    if (word === 'dictionary-timeout') throw Object.assign(new Error('timeout'), {code:'ECONNABORTED'});
    if (word === 'dictionary-network') throw Object.assign(new Error('offline'), {code:'ENOTFOUND'});
    if (word === 'dictionary-429' || word === 'dictionary-503') {
      throw Object.assign(new Error('upstream failed'), {response:{status:Number(word.slice('dictionary-'.length))}});
    }
    if (word === 'dictionary-malformed') {
      return {status:200,statusText:'OK',config,headers:{},data:{responseStatus:200,responseData:{bad:true}}};
    }
    const translatedText = word === 'dictionary-unknown' ? word : word === '学习' ? 'học tập' : `nghĩa của ${word}`;
    return {
      status:200,
      statusText:'OK',
      config,
      headers:{},
      data:{responseStatus:200,quotaFinished:false,responseData:{translatedText,match:1}},
    };
  }

  throw new Error('Unexpected upstream request');
};
