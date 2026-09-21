const axios = require('axios');
const {pinyin} = require('pinyin-pro');

const PROVIDER_URL = 'https://api.mymemory.translated.net/get';
const TIMEOUT_MS = 5000;

function providerError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeProviderStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) ? status : null;
}

function normalizeMeaning(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isSameText(left, right) {
  return left.normalize('NFKC').toLocaleLowerCase() === right.normalize('NFKC').toLocaleLowerCase();
}

function getPinyin(word) {
  const syllables = pinyin(word, {toneType: 'symbol', type: 'array'});
  return Array.isArray(syllables) && syllables.length > 0 ? syllables.join(' ') : null;
}

/**
 * Look up a Chinese word through MyMemory and normalize it to the frontend's
 * existing DictionaryLookupResult contract. Pinyin is generated locally so a
 * provider response never has to invent pronunciation data.
 */
async function lookupDictionaryWord(word) {
  let response;
  try {
    response = await axios.get(PROVIDER_URL, {
      timeout: TIMEOUT_MS,
      params: {
        q: word,
        langpair: 'zh-CN|vi-VN',
        mt: '1',
        ...(process.env.MYMEMORY_EMAIL ? {de: process.env.MYMEMORY_EMAIL} : {}),
      },
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw providerError('Dictionary provider timed out', 504, 'DICTIONARY_TIMEOUT');
    }
    if (error.response?.status === 429) {
      throw providerError('Dictionary provider rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
    }
    throw providerError('Dictionary provider request failed', 502, 'BAD_GATEWAY');
  }

  const data = response.data;
  if (!data || typeof data !== 'object' || !data.responseData || typeof data.responseData !== 'object') {
    throw providerError('Malformed dictionary provider response', 502, 'BAD_GATEWAY');
  }

  const providerStatus = normalizeProviderStatus(data.responseStatus);
  if (data.quotaFinished === true || providerStatus === 429) {
    throw providerError('Dictionary provider rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
  }
  if (providerStatus !== null && providerStatus >= 500) {
    throw providerError('Dictionary provider failed', 502, 'BAD_GATEWAY');
  }
  if (providerStatus !== null && providerStatus >= 400) {
    throw providerError('Dictionary word not found', 404, 'DICTIONARY_NOT_FOUND');
  }

  if (typeof data.responseData.translatedText !== 'string') {
    throw providerError('Malformed dictionary provider response', 502, 'BAD_GATEWAY');
  }

  const meaning = normalizeMeaning(data.responseData.translatedText);
  if (!meaning || isSameText(meaning, word)) {
    throw providerError('Dictionary word not found', 404, 'DICTIONARY_NOT_FOUND');
  }

  return {
    word,
    pinyin: getPinyin(word),
    meaning,
    partOfSpeech: null,
    examples: [],
    relatedWords: [],
    source: 'external',
    completeness: 'partial',
    fetchedAt: Date.now(),
  };
}

module.exports = {lookupDictionaryWord};
