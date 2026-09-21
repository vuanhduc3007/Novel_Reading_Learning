const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration - only allow frontend origin in production
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
// CORS must also cover body-parser errors returned before route handlers.
app.use(express.json({ limit: '10kb' }));

// Rate limiting: max 500 requests per 5 minutes per IP
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, 
  max: 500,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Import the provider adapter
const { translateText } = require('./providers/translationProvider');
const { lookupDictionaryWord } = require('./providers/dictionaryProvider');

function isLanguageCode(value) {
  return typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(value);
}

// Lightweight observability logging
function logRequest(type, provider, status, latency, chars) {
  console.log(`[${type}] provider=${provider} status=${status} latency=${latency}ms chars=${chars}`);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Basic translation endpoint
app.post('/api/translate', async (req, res) => {
  const reqStart = Date.now();
  const provider = process.env.TRANSLATION_PROVIDER || 'mock';
  let chars = 0;

  try {
    const { text, sourceLanguage, targetLanguage } = req.body || {};

    // Validate payload
    if (typeof text !== 'string' || !text.trim()) {
      const latency = Date.now() - reqStart;
      logRequest('translate', provider, 400, latency, chars);
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Invalid text payload' });
    }
    
    chars = text.length;
    if (chars > 500) {
      const latency = Date.now() - reqStart;
      logRequest('translate', provider, 400, latency, chars);
      return res.status(400).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Text exceeds maximum length of 500 characters' });
    }
    if ((sourceLanguage !== undefined && !isLanguageCode(sourceLanguage)) ||
        (targetLanguage !== undefined && !isLanguageCode(targetLanguage))) {
      const latency = Date.now() - reqStart;
      logRequest('translate', provider, 400, latency, chars);
      return res.status(400).json({ error: 'INVALID_LANGUAGE', message: 'Invalid language code' });
    }

    // 1. Mock Provider
    if (provider === 'mock') {
      await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
      if (Math.random() < 0.05) {
        const latency = Date.now() - reqStart;
        logRequest('translate', 'mock', 503, latency, chars);
        return res.status(503).json({ error: 'PROVIDER_UNAVAILABLE', message: 'Mock translation network error' });
      }
      
      const latency = Date.now() - reqStart;
      logRequest('translate', 'mock', 200, latency, chars);
      return res.json({
        translation: `[Backend Bản dịch] ${text}`,
        provider: 'mock',
        usage: { chars }
      });
    }

    // 2. Real Provider Integration
    if (provider === 'google-free') {
      try {
        const result = await translateText(text, sourceLanguage || 'zh-CN', targetLanguage || 'vi');
        const latency = Date.now() - reqStart;
        logRequest('translate', provider, 200, latency, chars);
        return res.json(result);
      } catch (providerError) {
        const latency = Date.now() - reqStart;
        
        // Normalize provider errors
        if (providerError.status === 429) {
          logRequest('translate', provider, 429, latency, chars);
          return res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Provider rate limit exceeded' });
        }
        if (providerError.status === 504) {
          logRequest('translate', provider, 504, latency, chars);
          return res.status(504).json({ error: 'TRANSLATION_TIMEOUT', message: 'Provider timeout' });
        }
        
        // Fallback for all other provider errors
        logRequest('translate', provider, 502, latency, chars);
        return res.status(502).json({ error: 'BAD_GATEWAY', message: 'Bad Gateway: Provider failed' });
      }
    }
    
    const latency = Date.now() - reqStart;
    logRequest('translate', provider, 501, latency, chars);
    return res.status(501).json({ error: 'NOT_IMPLEMENTED', message: 'Provider not implemented' });
  } catch (error) {
    const latency = Date.now() - reqStart;
    logRequest('translate', 'gateway', 500, latency, chars);
    // Normalize absolute internal failures
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal translation service error' });
  }
});

// Basic dictionary endpoint
app.post('/api/dictionary', async (req, res) => {
  const reqStart = Date.now();
  const provider = process.env.DICTIONARY_PROVIDER || 'unconfigured';
  let chars = 0;

  try {
    const { word } = req.body || {};

    if (typeof word !== 'string' || !word.trim() || word.length > 50) {
      const latency = Date.now() - reqStart;
      logRequest('dictionary', provider, 400, latency, chars);
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Invalid word payload' });
    }
    
    chars = word.length;
    if (provider === 'mock') {
      await new Promise(resolve => setTimeout(resolve, 600));
      const latency = Date.now() - reqStart;
      logRequest('dictionary', 'mock', 200, latency, chars);
      return res.json({
        word,
        pinyin: "mó nǐ",
        meaning: `[Backend Generated] Mock meaning for ${word}`,
        partOfSpeech: "unknown",
        examples: [{ chinese: `${word}是个好词`, vietnamese: `${word} là một từ hay` }],
        relatedWords: [],
        source: 'llm',
        completeness: 'complete',
        fetchedAt: Date.now()
      });
    }

    if (provider === 'mymemory') {
      try {
        const result = await lookupDictionaryWord(word.trim());
        const latency = Date.now() - reqStart;
        logRequest('dictionary', provider, 200, latency, chars);
        return res.json(result);
      } catch (providerError) {
        const latency = Date.now() - reqStart;

        if (providerError.status === 404) {
          logRequest('dictionary', provider, 404, latency, chars);
          return res.status(404).json({ error: 'DICTIONARY_NOT_FOUND', message: 'Dictionary word not found' });
        }
        if (providerError.status === 429) {
          logRequest('dictionary', provider, 429, latency, chars);
          return res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Provider rate limit exceeded' });
        }
        if (providerError.status === 504) {
          logRequest('dictionary', provider, 504, latency, chars);
          return res.status(504).json({ error: 'DICTIONARY_TIMEOUT', message: 'Provider timeout' });
        }

        logRequest('dictionary', provider, 502, latency, chars);
        return res.status(502).json({ error: 'BAD_GATEWAY', message: 'Bad Gateway: Provider failed' });
      }
    }

    if (provider === 'unconfigured') {
      const latency = Date.now() - reqStart;
      logRequest('dictionary', provider, 503, latency, chars);
      return res.status(503).json({
        error: 'DICTIONARY_NOT_CONFIGURED',
        message: 'Dictionary provider is not configured',
      });
    }

    const latency = Date.now() - reqStart;
    logRequest('dictionary', provider, 501, latency, chars);
    return res.status(501).json({ error: 'NOT_IMPLEMENTED', message: 'Provider not implemented' });
  } catch (error) {
    const latency = Date.now() - reqStart;
    logRequest('dictionary', 'gateway', 500, latency, chars);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal dictionary service error' });
  }
});

// Keep malformed JSON within the documented API error contract instead of
// falling through to Express's default HTML error page.
app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 10kb' });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'Malformed JSON request body' });
  }
  return next(error);
});

app.listen(PORT, () => {
  console.log(`Backend Gateway running on port ${PORT}`);
});
