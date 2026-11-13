const axios = require('axios');

/**
 * Google's keyless web translation endpoints.
 *
 * The former `translate_a/single` endpoint is aggressively rate limited (it
 * returns 429 for whole server IP ranges, including Render), which made most
 * sentences fail. `translate_a/t` accepts many `q` fields in one POST and
 * returns the translations as an ordered array, so a batch maps back to its
 * items without injecting marker text into the sentences.
 *
 * Endpoints are tried in order. One that answers 429/5xx/network errors is
 * put on a short cooldown so the next requests go straight to a healthy one.
 */
const PROVIDER_TIMEOUT_MS = 8000;
const COOLDOWN_MS = 60_000;
const CACHE_LIMIT = 5000;

const ENDPOINTS = [
  { name: 'gtx', url: 'https://translate.googleapis.com/translate_a/t', client: 'gtx' },
  { name: 'dict-chrome-ex', url: 'https://clients5.google.com/translate_a/t', client: 'dict-chrome-ex' },
];
const cooldownUntil = new Map();
const cache = new Map();

function normalizeLanguage(code, fallback) {
  if (!code) return fallback;
  if (code === 'zh' || code === 'zh-Hans') return 'zh-CN';
  if (code === 'zh-Hant') return 'zh-TW';
  return code;
}

function providerError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeTransportError(error) {
  if (Number.isInteger(error.status)) return error;
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ERR_CANCELED') {
    return providerError('Provider request timed out', 504);
  }
  if (error.response && Number.isInteger(error.response.status)) {
    return providerError(`Provider returned status ${error.response.status}`, error.response.status);
  }
  return providerError('Provider network error', 502);
}

function parseTranslations(data, expected) {
  // Shapes observed: ["a","b"] for a fixed source language, [["a","zh-CN"],…]
  // for auto-detect, and a bare string for a single item on some clients.
  const list = typeof data === 'string' ? [data] : data;
  if (!Array.isArray(list) || list.length !== expected) return null;
  const output = list.map(entry => {
    if (typeof entry === 'string') return entry;
    if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
    return null;
  });
  return output.every(text => typeof text === 'string') ? output : null;
}

async function requestEndpoint(endpoint, texts, sourceLanguage, targetLanguage) {
  const body = texts.map(text => `q=${encodeURIComponent(text)}`).join('&');
  let response;
  try {
    response = await axios.post(endpoint.url, body, {
      params: { client: endpoint.client, sl: sourceLanguage, tl: targetLanguage, ie: 'UTF-8', oe: 'UTF-8' },
      timeout: PROVIDER_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    });
  } catch (error) {
    throw normalizeTransportError(error);
  }
  if (response.status >= 400) throw providerError(`Provider returned status ${response.status}`, response.status);
  const translations = parseTranslations(response.data, texts.length);
  if (!translations) throw providerError('Malformed response from provider', 502);
  return translations;
}

/**
 * Translate many texts in one upstream call. Resolves with translations in the
 * same order. Cached texts are not sent again.
 */
async function translateMany(texts, sourceLanguage, targetLanguage) {
  const sl = normalizeLanguage(sourceLanguage, 'zh-CN');
  const tl = normalizeLanguage(targetLanguage, 'vi');
  const results = new Array(texts.length).fill(null);
  const missing = [];
  texts.forEach((text, index) => {
    const cached = cache.get(`${sl}|${tl}|${text}`);
    if (cached !== undefined) results[index] = cached;
    else missing.push(index);
  });
  if (missing.length === 0) return { translations: results, provider: 'cache' };

  const now = Date.now();
  const ordered = [
    ...ENDPOINTS.filter(endpoint => (cooldownUntil.get(endpoint.name) ?? 0) <= now),
    ...ENDPOINTS.filter(endpoint => (cooldownUntil.get(endpoint.name) ?? 0) > now),
  ];
  let lastError = providerError('No translation endpoint available', 502);
  for (const endpoint of ordered) {
    try {
      const translated = await requestEndpoint(endpoint, missing.map(index => texts[index]), sl, tl);
      cooldownUntil.delete(endpoint.name);
      missing.forEach((textIndex, position) => {
        results[textIndex] = translated[position];
        const key = `${sl}|${tl}|${texts[textIndex]}`;
        if (translated[position]) {
          cache.set(key, translated[position]);
          if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        }
      });
      return { translations: results, provider: endpoint.name };
    } catch (error) {
      lastError = error;
      if (error.status === 429 || error.status >= 500) cooldownUntil.set(endpoint.name, Date.now() + COOLDOWN_MS);
    }
  }
  throw lastError;
}

async function translateText(text, sourceLanguage, targetLanguage) {
  const { translations } = await translateMany([text], sourceLanguage, targetLanguage);
  const translation = translations[0]?.trim();
  if (!translation) throw providerError('Malformed response from provider', 502);
  return { translation, provider: 'google-free', usage: { chars: text.length } };
}

async function translateBatch(items, sourceLanguage, targetLanguage) {
  const { translations } = await translateMany(items.map(item => item.text), sourceLanguage, targetLanguage);
  return {
    results: items.map((item, index) => {
      const translation = translations[index]?.trim();
      if (translation) return { id: item.id, status: 'translated', translation };
      return {
        id: item.id,
        status: 'failed',
        error: {
          code: 'MALFORMED_PROVIDER_RESPONSE',
          message: 'Provider response did not contain this batch item',
          retryable: true,
        },
      };
    }),
    provider: 'google-free',
    usage: { chars: items.reduce((sum, item) => sum + item.text.length, 0) },
  };
}

function resetProviderState() {
  cache.clear();
  cooldownUntil.clear();
}

module.exports = {
  translateText,
  translateBatch,
  translateMany,
  resetProviderState,
};
