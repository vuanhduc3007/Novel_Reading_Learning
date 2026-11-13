const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

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
app.use(express.json({ limit: '64kb' }));

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const TRANSLATION_RATE_LIMIT_MAX = positiveInteger(process.env.TRANSLATION_RATE_LIMIT_MAX, 500);
const DICTIONARY_RATE_LIMIT_MAX = positiveInteger(process.env.DICTIONARY_RATE_LIMIT_MAX, 120);
// One upstream POST carries the whole batch, so batches can be much larger
// than the old URL-encoded GET allowed. Fewer round trips = faster chapters.
const MAX_BATCH_ITEMS = 25;
const MAX_BATCH_PROVIDER_CHARS = 2500;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clientRateLimitKey(req) {
  // Render terminates public traffic at its edge/load balancer and documents
  // X-Forwarded-For as the source of the original client IP. Only trust that
  // header inside a verified Render runtime; local/direct deployments keep
  // using Express's socket-derived req.ip.
  if (process.env.RENDER === 'true' || process.env.RENDER_EXTERNAL_URL) {
    const forwarded = req.get('x-forwarded-for');
    const clientIp = forwarded?.split(',')[0]?.trim();
    if (clientIp) return ipKeyGenerator(clientIp);
  }
  return ipKeyGenerator(req.ip);
}

function createApiLimiter(max, routeName) {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max,
    keyGenerator: clientRateLimitKey,
    standardHeaders: 'draft-7',
    legacyHeaders: true,
    // A custom Render-only key generator handles the forwarded header. These
    // generic validations otherwise warn because Express trust proxy remains
    // deliberately disabled rather than being set broadly to true.
    validate: { xForwardedForHeader: false, trustProxy: false },
    handler: (req, res) => {
      const retryAfter = Number(res.getHeader('Retry-After')) || Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
      res.status(429).json({
        error: 'APP_RATE_LIMIT',
        message: `${routeName} request limit exceeded`,
        retryAfterSeconds: retryAfter,
      });
    },
  });
}

const translationLimiter = createApiLimiter(TRANSLATION_RATE_LIMIT_MAX, 'Translation');
const dictionaryLimiter = createApiLimiter(DICTIONARY_RATE_LIMIT_MAX, 'Dictionary');

// Import the provider adapter
const { translateText, translateBatch } = require('./providers/translationProvider');
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

app.use('/api/translate', translationLimiter);
app.use('/api/dictionary', dictionaryLimiter);

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

app.post('/api/translate/batch', async (req, res) => {
  const reqStart = Date.now();
  const provider = process.env.TRANSLATION_PROVIDER || 'mock';
  let chars = 0;

  try {
    const { items, sourceLanguage, targetLanguage } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH_ITEMS) {
      logRequest('translate-batch', provider, 400, Date.now() - reqStart, chars);
      return res.status(400).json({ error: 'INVALID_BATCH', message: `Batch must contain 1-${MAX_BATCH_ITEMS} items` });
    }
    if ((sourceLanguage !== undefined && !isLanguageCode(sourceLanguage)) ||
        (targetLanguage !== undefined && !isLanguageCode(targetLanguage))) {
      logRequest('translate-batch', provider, 400, Date.now() - reqStart, chars);
      return res.status(400).json({ error: 'INVALID_LANGUAGE', message: 'Invalid language code' });
    }

    const ids = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128 ||
          typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500 || ids.has(item.id)) {
        logRequest('translate-batch', provider, 400, Date.now() - reqStart, chars);
        return res.status(400).json({ error: 'INVALID_BATCH_ITEM', message: 'Batch items require unique ids and valid text' });
      }
      ids.add(item.id);
    }

    chars = items.reduce((sum, item) => sum + item.text.length, 0);
    if (chars > MAX_BATCH_PROVIDER_CHARS) {
      logRequest('translate-batch', provider, 400, Date.now() - reqStart, chars);
      return res.status(400).json({
        error: 'BATCH_TOO_LARGE',
        message: `Batch exceeds ${MAX_BATCH_PROVIDER_CHARS} characters`,
      });
    }

    if (provider === 'mock') {
      const latency = Date.now() - reqStart;
      logRequest('translate-batch', provider, 200, latency, chars);
      return res.json({
        results: items.map(item => ({ id: item.id, status: 'translated', translation: `[Backend Bản dịch] ${item.text}` })),
        provider: 'mock',
        usage: { chars },
      });
    }

    if (provider === 'google-free') {
      try {
        const result = await translateBatch(items, sourceLanguage || 'zh-CN', targetLanguage || 'vi');
        logRequest('translate-batch', provider, 200, Date.now() - reqStart, chars);
        return res.json(result);
      } catch (providerError) {
        const latency = Date.now() - reqStart;
        if (providerError.status === 429) {
          logRequest('translate-batch', provider, 429, latency, chars);
          return res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Provider rate limit exceeded' });
        }
        if (providerError.status === 504) {
          logRequest('translate-batch', provider, 504, latency, chars);
          return res.status(504).json({ error: 'TRANSLATION_TIMEOUT', message: 'Provider timeout' });
        }
        logRequest('translate-batch', provider, 502, latency, chars);
        return res.status(502).json({ error: 'BAD_GATEWAY', message: 'Bad Gateway: Provider failed' });
      }
    }

    logRequest('translate-batch', provider, 501, Date.now() - reqStart, chars);
    return res.status(501).json({ error: 'NOT_IMPLEMENTED', message: 'Provider not implemented' });
  } catch {
    logRequest('translate-batch', 'gateway', 500, Date.now() - reqStart, chars);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal translation service error' });
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
    return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 64kb' });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'Malformed JSON request body' });
  }
  return next(error);
});

app.listen(PORT, () => {
  console.log(`Backend Gateway running on port ${PORT}`);
});
