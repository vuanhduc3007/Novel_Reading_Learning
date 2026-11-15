const axios = require('axios');
const {pinyin} = require('pinyin-pro');
const {translateMany} = require('./translationProvider');

const PROVIDER_URL = 'https://api.mymemory.translated.net/get';
const TIMEOUT_MS = 5000;
// MyMemory's free quota is per day and shared by everyone on the server's IP.
// Once it says the quota is gone, stop asking it for a while.
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
let myMemoryBlockedUntil = 0;

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

async function lookupMyMemory(word) {
  if (Date.now() < myMemoryBlockedUntil) {
    throw providerError('Dictionary provider rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
  }
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
      myMemoryBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS;
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
    myMemoryBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS;
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

  return normalizeMeaning(data.responseData.translatedText);
}

/** The same keyless Google endpoints the sentence translator uses. */
async function lookupGoogle(word) {
  const {translations} = await translateMany([word], 'zh-CN', 'vi');
  return normalizeMeaning(translations[0]);
}

/**
 * Look up a Chinese word (Google first, MyMemory if Google is unavailable) and
 * normalize it to the frontend's DictionaryLookupResult contract. Pinyin is
 * generated locally so a provider never has to invent pronunciation data.
 */
async function lookupDictionaryWord(word) {
  let meaning;
  try {
    meaning = await lookupGoogle(word);
  } catch {
    meaning = await lookupMyMemory(word);
  }
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

function resetDictionaryState() {
  myMemoryBlockedUntil = 0;
}

module.exports = {lookupDictionaryWord, resetDictionaryState};
