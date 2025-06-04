const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// In-memory cache for audio URLs and metadata
let audioCache = new Map();
let preloadQueue = new Map();
let requestMetrics = new Map();

// Audio service configuration
const AUDIO_CONFIG = {
  TTS_BASE_URL: 'https://translate.google.com/translate_tts',
  MAX_CACHE_SIZE: 1000,
  PRELOAD_TIMEOUT: 5000,
  SUPPORTED_LANGUAGES: ['zh-CN', 'zh-TW'],
  DEFAULT_LANGUAGE: 'zh-CN'
};

// Generate audio URL for Chinese text
function generateAudioUrl(text, language = 'zh-CN') {
  const params = new URLSearchParams({
    ie: 'UTF-8',
    q: text,
    tl: language,
    client: 'tw-ob'
  });
  
  return `${AUDIO_CONFIG.TTS_BASE_URL}?${params.toString()}`;
}

// Generate cache key for audio requests
function generateCacheKey(text, language) {
  return crypto.createHash('md5').update(`${text}-${language}`).digest('hex');
}

// Clean old cache entries when cache is full
function cleanCache() {
  if (audioCache.size >= AUDIO_CONFIG.MAX_CACHE_SIZE) {
    const entriesToRemove = Math.floor(AUDIO_CONFIG.MAX_CACHE_SIZE * 0.2);
    const entries = Array.from(audioCache.entries());
    
    for (let i = 0; i < entriesToRemove; i++) {
      audioCache.delete(entries[i][0]);
    }
    
    console.log(`Cleaned ${entriesToRemove} old cache entries`);
  }
}

// Validate Chinese text input
function isValidChineseText(text) {
  if (!text || typeof text !== 'string') return false;
  
  const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  return chineseRegex.test(text) && text.length <= 100;
}

// Record response time metrics
function recordMetrics(endpoint, responseTime) {
  if (!requestMetrics.has(endpoint)) {
    requestMetrics.set(endpoint, []);
  }
  
  const metrics = requestMetrics.get(endpoint);
  metrics.push(responseTime);
  
  if (metrics.length > 100) {
    metrics.shift();
  }
}

// Health check
app.get('/health', (req, res) => {
  const startTime = Date.now();
  
  const avgResponseTimes = {};
  for (const [endpoint, times] of requestMetrics) {
    if (times.length > 0) {
      avgResponseTimes[endpoint] = Math.round(
        times.reduce((a, b) => a + b, 0) / times.length
      );
    }
  }
  
  const responseTime = Date.now() - startTime;
  
  res.json({
    status: 'healthy',
    service: 'Pronunciation Audio Service',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    cache: {
      size: audioCache.size,
      maxSize: AUDIO_CONFIG.MAX_CACHE_SIZE
    },
    averageResponseTimes: avgResponseTimes,
    responseTime: `${responseTime}ms`
  });
});

// Get pronunciation audio URL
app.post('/audio', (req, res) => {
  const startTime = Date.now();
  
  try {
    const { text, language = AUDIO_CONFIG.DEFAULT_LANGUAGE } = req.body;
    
    if (!isValidChineseText(text)) {
      return res.status(400).json({
        error: 'Invalid Chinese text provided',
        details: 'Text must contain Chinese characters and be less than 100 characters'
      });
    }
    
    if (!AUDIO_CONFIG.SUPPORTED_LANGUAGES.includes(language)) {
      return res.status(400).json({
        error: 'Unsupported language',
        supportedLanguages: AUDIO_CONFIG.SUPPORTED_LANGUAGES
      });
    }
    
    const cacheKey = generateCacheKey(text, language);
    
    if (audioCache.has(cacheKey)) {
      const cachedData = audioCache.get(cacheKey);
      const responseTime = Date.now() - startTime;
      
      recordMetrics('/audio', responseTime);
      
      return res.json({
        success: true,
        text,
        language,
        audioUrl: `/play/${cacheKey}`,
        cached: true,
        responseTime: `${responseTime}ms`
      });
    }
    
    const audioUrl = generateAudioUrl(text, language);
    
    cleanCache();
    audioCache.set(cacheKey, {
      audioUrl,
      text,
      language,
      timestamp: new Date().toISOString()
    });
    
    const responseTime = Date.now() - startTime;
    recordMetrics('/audio', responseTime);
    
    res.json({
      success: true,
      text,
      language,
      audioUrl: `/play/${cacheKey}`,
      cached: false,
      responseTime: `${responseTime}ms`
    });
    
  } catch (error) {
    console.error('Error generating audio URL:', error);
    const responseTime = Date.now() - startTime;
    
    res.status(500).json({
      error: 'Internal server error while generating audio',
      responseTime: `${responseTime}ms`
    });
  }
});

// Proxy endpoint to serve audio files (fixes CORS issues)
app.get('/play/:cacheKey', (req, res) => {
  const { cacheKey } = req.params;
  
  if (!audioCache.has(cacheKey)) {
    return res.status(404).json({
      error: 'Audio not found',
      details: 'The requested audio has not been cached or has expired'
    });
  }
  
  const cachedData = audioCache.get(cacheKey);
  const audioUrl = cachedData.audioUrl;
  
  console.log(`Proxying audio for ${cachedData.text}: ${audioUrl}`);
  
  const request = https.get(audioUrl, (audioResponse) => {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    audioResponse.pipe(res);
  });
  
  request.on('error', (error) => {
    console.error('Error proxying audio:', error);
    res.status(500).json({
      error: 'Failed to retrieve audio',
      details: error.message
    });
  });
  
  request.setTimeout(10000, () => {
    request.destroy();
    res.status(504).json({
      error: 'Audio request timed out'
    });
  });
});

// Preload audio for next card 
app.post('/preload', (req, res) => {
  const startTime = Date.now();
  
  try {
    const { texts, language = AUDIO_CONFIG.DEFAULT_LANGUAGE } = req.body;
    
    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({
        error: 'Invalid input: texts must be a non-empty array'
      });
    }
    
    if (texts.length > 10) {
      return res.status(400).json({
        error: 'Too many texts to preload (maximum 10)'
      });
    }
    
    for (const text of texts) {
      if (!isValidChineseText(text)) {
        return res.status(400).json({
          error: `Invalid Chinese text: "${text}"`,
          details: 'All texts must contain Chinese characters and be less than 100 characters'
        });
      }
    }
    
    if (!AUDIO_CONFIG.SUPPORTED_LANGUAGES.includes(language)) {
      return res.status(400).json({
        error: 'Unsupported language',
        supportedLanguages: AUDIO_CONFIG.SUPPORTED_LANGUAGES
      });
    }
    
    const preloadId = crypto.randomUUID();
    const preloadData = {
      id: preloadId,
      texts,
      language,
      status: 'processing',
      results: [],
      startTime: Date.now(),
      timestamp: new Date().toISOString()
    };
    
    preloadQueue.set(preloadId, preloadData);
    
    setImmediate(async () => {
      try {
        const results = [];
        
        for (const text of texts) {
          const cacheKey = generateCacheKey(text, language);
          
          let audioUrl;
          let cached = false;
          
          if (audioCache.has(cacheKey)) {
            audioUrl = `/play/${cacheKey}`;
            cached = true;
          } else {
            const externalUrl = generateAudioUrl(text, language);
            
            cleanCache();
            audioCache.set(cacheKey, {
              audioUrl: externalUrl,
              text,
              language,
              timestamp: new Date().toISOString()
            });
            
            audioUrl = `/play/${cacheKey}`;
          }
          
          results.push({
            text,
            audioUrl,
            cached
          });
        }
        
        preloadData.status = 'completed';
        preloadData.results = results;
        preloadData.completedTime = Date.now();
        preloadData.processingDuration = preloadData.completedTime - preloadData.startTime;
        
      } catch (error) {
        console.error('Error during preloading:', error);
        preloadData.status = 'failed';
        preloadData.error = error.message;
      }
    });
    
    const responseTime = Date.now() - startTime;
    recordMetrics('/preload', responseTime);
    
    res.json({
      success: true,
      preloadId,
      status: 'processing',
      textsCount: texts.length,
      language,
      responseTime: `${responseTime}ms`,
      statusUrl: `/preload/${preloadId}`
    });
    
  } catch (error) {
    console.error('Error initiating preload:', error);
    const responseTime = Date.now() - startTime;
    
    res.status(500).json({
      error: 'Internal server error while initiating preload',
      responseTime: `${responseTime}ms`
    });
  }
});

// Get preload status
app.get('/preload/:preloadId', (req, res) => {
  const startTime = Date.now();
  
  try {
    const { preloadId } = req.params;
    
    if (!preloadQueue.has(preloadId)) {
      return res.status(404).json({
        error: 'Preload request not found',
        preloadId
      });
    }
    
    const preloadData = preloadQueue.get(preloadId);
    const responseTime = Date.now() - startTime;
    
    if (preloadData.status === 'completed' || preloadData.status === 'failed') {
      const age = Date.now() - preloadData.startTime;
      if (age > 300000) {
        preloadQueue.delete(preloadId);
      }
    }
    
    res.json({
      success: true,
      preloadId,
      status: preloadData.status,
      results: preloadData.results || [],
      textsCount: preloadData.texts.length,
      language: preloadData.language,
      processingDuration: preloadData.processingDuration,
      timestamp: preloadData.timestamp,
      responseTime: `${responseTime}ms`
    });
    
  } catch (error) {
    console.error('Error getting preload status:', error);
    const responseTime = Date.now() - startTime;
    
    res.status(500).json({
      error: 'Internal server error while getting preload status',
      responseTime: `${responseTime}ms`
    });
  }
});

// Get cache statistics
app.get('/cache/stats', (req, res) => {
  const startTime = Date.now();
  
  try {
    const cacheEntries = Array.from(audioCache.values());
    const languageStats = {};
    
    cacheEntries.forEach(entry => {
      if (!languageStats[entry.language]) {
        languageStats[entry.language] = 0;
      }
      languageStats[entry.language]++;
    });
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      success: true,
      cache: {
        size: audioCache.size,
        maxSize: AUDIO_CONFIG.MAX_CACHE_SIZE,
        utilization: Math.round((audioCache.size / AUDIO_CONFIG.MAX_CACHE_SIZE) * 100),
        languageBreakdown: languageStats
      },
      preloadQueue: {
        active: preloadQueue.size
      },
      responseTime: `${responseTime}ms`
    });
    
  } catch (error) {
    console.error('Error getting cache stats:', error);
    const responseTime = Date.now() - startTime;
    
    res.status(500).json({
      error: 'Internal server error while getting cache stats',
      responseTime: `${responseTime}ms`
    });
  }
});

// Clear cache (admin endpoint)
app.post('/cache/clear', (req, res) => {
  const startTime = Date.now();
  
  try {
    const previousSize = audioCache.size;
    audioCache.clear();
    preloadQueue.clear();
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
      previousCacheSize: previousSize,
      responseTime: `${responseTime}ms`
    });
    
  } catch (error) {
    console.error('Error clearing cache:', error);
    const responseTime = Date.now() - startTime;
    
    res.status(500).json({
      error: 'Internal server error while clearing cache',
      responseTime: `${responseTime}ms`
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /audio',
      'GET /play/:cacheKey',
      'POST /preload',
      'GET /preload/:preloadId',
      'GET /cache/stats',
      'POST /cache/clear'
    ]
  });
});

// Cleanup old preload requests periodically
setInterval(() => {
  const now = Date.now();
  const cutoff = 300000;
  
  for (const [id, data] of preloadQueue) {
    if (now - data.startTime > cutoff) {
      preloadQueue.delete(id);
    }
  }
}, 60000);

// Start server
app.listen(PORT, () => {
  console.log(`Pronunciation Audio Service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Audio endpoint: http://localhost:${PORT}/audio`);
  console.log(`Audio proxy: http://localhost:${PORT}/play/:cacheKey`);
  console.log(`Preload endpoint: http://localhost:${PORT}/preload`);
});

module.exports = app;