// Test-process-only transport. Exercises the actual provider adapter without
// contacting Google or transmitting any book content outside localhost.
const axios = require('axios');
axios.defaults.adapter = async config => {
  const url = new URL(config.url);
  if (config.timeout !== 5000) throw new Error('Missing provider timeout');

  if (url.hostname === 'translate.googleapis.com') {
    const text = url.searchParams.get('q');
    if (text === 'timeout') throw Object.assign(new Error('timeout'), {code:'ECONNABORTED'});
    if (text === 'network') throw Object.assign(new Error('offline'), {code:'ENOTFOUND'});
    if (text === '429' || text === '503') throw Object.assign(new Error('upstream failed'), {response:{status:Number(text)}});
    return {status:200, statusText:'OK', config, headers:{}, data:text === 'malformed' ? {bad:true} : [[['Bản dịch thử nghiệm',text]]]};
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
