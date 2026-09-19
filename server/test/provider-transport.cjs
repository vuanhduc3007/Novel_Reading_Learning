// Test-process-only transport. Exercises the actual provider adapter without
// contacting Google or transmitting any book content outside localhost.
const axios = require('axios');
axios.defaults.adapter = async config => {
  const url = new URL(config.url);
  if (url.hostname !== 'translate.googleapis.com' || config.timeout !== 5000) {
    throw new Error('Unexpected upstream request or missing timeout');
  }
  const text = url.searchParams.get('q');
  if (text === 'timeout') throw Object.assign(new Error('timeout'), {code:'ECONNABORTED'});
  if (text === 'network') throw Object.assign(new Error('offline'), {code:'ENOTFOUND'});
  if (text === '429' || text === '503') throw Object.assign(new Error('upstream failed'), {response:{status:Number(text)}});
  return {status:200, statusText:'OK', config, headers:{}, data:text === 'malformed' ? {bad:true} : [[['Bản dịch thử nghiệm',text]]]};
};
