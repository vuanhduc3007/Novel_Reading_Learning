const axios = require('axios');

/**
 * Adapter for a real external translation provider.
 * Using Google Translate's free internal API as a keyless demonstration
 * for Phase 8 to prove the architecture end-to-end without requiring a paid API key.
 * 
 * In a real production deployment with a budget, this could easily be swapped 
 * to DeepL or OpenAI by simply changing the endpoint and injecting the API key.
 */
async function translateText(text, sourceLanguage, targetLanguage) {
  // Enforce a strict timeout at the provider level
  const TIMEOUT_MS = 5000;
  
  try {
    // API contract for translate.googleapis.com (Free tier for demonstration)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLanguage}&tl=${targetLanguage}&dt=t&q=${encodeURIComponent(text)}`;
    
    const response = await axios.get(url, { timeout: TIMEOUT_MS });
    
    if (response.status >= 400) {
      const error = new Error(`Provider returned status ${response.status}`);
      error.status = response.status;
      throw error;
    }

    // Google Translate returns an array of arrays.
    // e.g. [[["Bản dịch", "Source", null, null, 1]], null, "zh-CN"]
    const data = response.data;
    if (!data || !Array.isArray(data) || !data[0]) {
      throw new Error('Malformed response from provider');
    }

    // Concatenate the translated parts (sentences)
    const translation = data[0]
      .map(part => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')
      .join('');
    if (!translation) {
      throw new Error('Malformed response from provider');
    }

    return {
      translation,
      provider: 'google-free',
      usage: { chars: text.length }
    };

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      const e = new Error('Provider request timed out');
      e.status = 504;
      throw e;
    }
    if (error.response && Number.isInteger(error.response.status)) {
      const e = new Error(`Provider returned status ${error.response.status}`);
      e.status = error.response.status;
      throw e;
    }
    throw error; // Re-throw to be caught by the Gateway
  }
}

module.exports = {
  translateText
};
