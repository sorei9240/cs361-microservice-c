# Microservice C - Pronunciation Audio Service

## Overview

The Pronunciation Audio Service provides audio pronunciation examples and preloading functionality for the HSK Flashcard application. 

## Features

- **Audio URL Generation**: Provides audio URLs for Chinese text using TTS services
- **Intelligent Caching**: Caches audio URLs to improve performance and reduce external API calls
- **Batch Preloading**: Allows preloading multiple audio files in the background
- **Health Monitoring**: Tracks uptime, response times, and cache statistics
- **Input Validation**: Validates Chinese text input and prevents invalid requests
- **Error Handling**: Comprehensive error handling with detailed error messages

## API Endpoints

### Health Check
```http
GET /health
```
Returns service health status, uptime, and performance metrics.

### Get Audio URL
```http
POST /audio
Content-Type: application/json

{
  "text": "你好",
  "language": "zh-CN"
}
```

### Preload Audio
```http
POST /preload
Content-Type: application/json

{
  "texts": ["学习", "中文", "很好"],
  "language": "zh-CN"
}
```

### Check Preload Status
```http
GET /preload/{preloadId}
```

### Cache Statistics
```http
GET /cache/stats
```

### Clear Cache (Admin)
```http
POST /cache/clear
```

## Setup Instructions

1. **Create the microservice directory:**
   ```bash
   mkdir microservice-c
   cd microservice-c
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the service:**
   ```bash
   npm start
   ```

4. **Test the service:**
   ```bash
   npm test
   ```

The service will run on `http://localhost:3002` by default.


## Monitoring and Metrics

The service tracks several key metrics accessible via `/health`:

- **Response Times**: Average response times per endpoint
- **Cache Performance**: Hit rates and utilization
- **Uptime**: Service uptime in seconds
- **Active Requests**: Number of active preload requests

## Configuration

Key configuration options in `server.js`:

```javascript
const AUDIO_CONFIG = {
  TTS_BASE_URL: 'https://translate.google.com/translate_tts',
  MAX_CACHE_SIZE: 1000,
  PRELOAD_TIMEOUT: 5000,
  SUPPORTED_LANGUAGES: ['zh-CN', 'zh-TW'],
  DEFAULT_LANGUAGE: 'zh-CN'
};
```


## Dependencies

- **express**: Web framework
- **cors**: Cross-origin resource sharing
- **crypto**: For generating cache keys and UUIDs
- **fs**: File system operations (for future persistence)
