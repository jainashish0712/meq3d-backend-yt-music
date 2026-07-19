'use strict';

const ytdl = require('@distube/ytdl-core');
const cache = require('./cache');
const { DEFAULT_CACHE_TTL } = require('../config/constants');

const fs = require('fs');
const path = require('path');

/**
 * Create a ytdl agent with cookies from environment or a local cookies.json file.
 * Cookies help avoid YouTube rate limiting on shared cloud IPs and local connections.
 * 
 * You can place a 'cookies.json' file in the root of the backend folder with your JSON cookies:
 * [
 *   {"name":"__Secure-1PSID","value":"xxx","domain":".youtube.com"}
 * ]
 * 
 * Or set YT_COOKIES env var as the JSON string.
 */
let ytdlAgent = null;

/**
 * Parses a cookie string or JSON array into an array of cookie objects.
 * Supports:
 * 1. JSON array format: [{"name": "foo", "value": "bar"}, ...]
 * 2. Raw Cookie Header format: "name1=value1; name2=value2"
 */
function parseCookies(content) {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      console.warn('[cookies] Failed to parse cookies as JSON array:', e.message);
    }
  }

  // Fallback: parse as standard raw cookie string
  try {
    const cookies = [];
    const pairs = trimmed.split(';');
    for (let pair of pairs) {
      const trimmedPair = pair.trim();
      if (!trimmedPair) continue;
      const index = trimmedPair.indexOf('=');
      if (index === -1) continue;
      const name = trimmedPair.substring(0, index).trim();
      const value = trimmedPair.substring(index + 1).trim();
      if (name) {
        cookies.push({
          name,
          value,
          domain: '.youtube.com',
          path: '/',
          secure: true
        });
      }
    }
    return cookies.length > 0 ? cookies : null;
  } catch (e) {
    console.warn('[cookies] Failed to parse raw cookie string:', e.message);
    return null;
  }
}

function getAgent() {
  if (ytdlAgent) return ytdlAgent;

  // 1. Try reading cookies.json from project root
  let cookies = null;
  try {
    const cookiesPath = path.join(__dirname, '../../cookies.json');
    if (fs.existsSync(cookiesPath)) {
      const fileContent = fs.readFileSync(cookiesPath, 'utf8');
      cookies = parseCookies(fileContent);
      console.log('[stream] Loaded cookies from cookies.json');
    }
  } catch (e) {
    console.warn('[stream] Failed to load cookies.json:', e.message);
  }
  
  // 2. Fallback to YT_COOKIES env var
  if (!cookies) {
    const cookiesEnv = process.env.YT_COOKIES;
    if (cookiesEnv) {
      try {
        cookies = parseCookies(cookiesEnv);
        console.log('[stream] Loaded cookies from YT_COOKIES env var');
      } catch (e) {
        console.warn('[stream] Failed to parse YT_COOKIES:', e.message);
      }
    }
  }

  // 3. Create the agent (with proxy if YT_PROXY is defined)
  const proxyUri = process.env.YT_PROXY;
  if (proxyUri) {
    try {
      ytdlAgent = ytdl.createProxyAgent({ uri: proxyUri }, cookies || undefined);
      console.log('[stream] Created ytdl proxy agent with proxy:', proxyUri, 'and', cookies ? cookies.length : 0, 'cookies');
    } catch (e) {
      console.error('[stream] Failed to create ytdl proxy agent:', e.message);
    }
  } else if (cookies) {
    try {
      ytdlAgent = ytdl.createAgent(cookies);
      console.log('[stream] Created ytdl agent with', cookies.length, 'cookies');
    } catch (e) {
      console.error('[stream] Failed to create ytdl agent:', e.message);
    }
  }

  return ytdlAgent;
}

/**
 * Extract the best audio stream URL for a YouTube video using @distube/ytdl-core.
 * This library handles cipher decryption, signature extraction, and format
 * negotiation automatically — no external binaries (yt-dlp) needed.
 *
 * Results are cached in memory with a configurable TTL.
 *
 * @param {string} videoId — YouTube video ID (e.g. 'dQw4w9WgXcQ')
 * @returns {Promise<{ streamUrl: string, format: string, bitrate: number, contentLength: string, durationMs: number, expiresIn: number }>}
 */
async function getStreamUrl(videoId) {
  // 1. Check cache first
  const cached = cache.get(`stream:${videoId}`);
  if (cached) {
    return cached;
  }

  // 2. Get video info (handles cipher decryption internally)
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const agent = getAgent();
  
  const infoOptions = {
    requestOptions: {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    },
  };
  if (agent) {
    infoOptions.agent = agent;
  }

  let info;
  let lastError;

  // Retry up to 3 times with increasing delays
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      info = await ytdl.getInfo(videoUrl, infoOptions);
      break; // success
    } catch (err) {
      lastError = err;
      console.warn(`[stream] getInfo attempt ${attempt + 1} failed for ${videoId}:`, err.message);
      
      // If rate limited (429), wait before retrying
      if (err.message?.includes('429') || err.message?.includes('Too Many')) {
        const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Non-retryable error
        throw err;
      }
    }
  }

  if (!info) {
    throw lastError || new Error(`Failed to get info for ${videoId}`);
  }

  // 3. Check playability
  if (!info.formats || info.formats.length === 0) {
    throw new Error(`No formats available for video ${videoId}`);
  }

  // 4. Get the best audio-only format
  //    Prefer MP4/M4A (best compatibility with mobile players like ExoPlayer/AVPlayer)
  const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

  if (audioFormats.length === 0) {
    throw new Error(`No audio-only streams found for ${videoId}`);
  }

  // Sort: MP4 first (for mobile compatibility), then by bitrate descending
  const sorted = audioFormats.sort((a, b) => {
    const aIsMp4 = (a.mimeType || '').includes('mp4');
    const bIsMp4 = (b.mimeType || '').includes('mp4');
    if (aIsMp4 && !bIsMp4) return -1;
    if (!aIsMp4 && bIsMp4) return 1;
    return (b.audioBitrate || 0) - (a.audioBitrate || 0);
  });

  const bestFormat = sorted[0];

  if (!bestFormat.url) {
    throw new Error(`No playable audio URL for ${videoId} (cipher protected)`);
  }

  const streamData = {
    streamUrl: bestFormat.url,
    format: (bestFormat.mimeType || 'audio/mp4').split(';')[0],
    bitrate: bestFormat.audioBitrate || 0,
    contentLength: bestFormat.contentLength || null,
    durationMs: parseInt(info.videoDetails.lengthSeconds || '0', 10) * 1000,
    expiresIn: DEFAULT_CACHE_TTL,
  };

  // 5. Cache the result
  cache.set(`stream:${videoId}`, streamData, DEFAULT_CACHE_TTL);

  return streamData;
}

/**
 * Proxy an audio stream through the server.
 * Uses ytdl's built-in streaming which handles cipher decryption,
 * chunked downloading, and reconnection automatically.
 *
 * @param {string} videoId
 * @param {import('express').Response} res
 */
async function proxyStream(videoId, res) {
  try {
    // First get the format info so we can set proper headers
    const streamData = await getStreamUrl(videoId);

    // Set response headers for the mobile player
    const contentType = streamData.format || 'audio/mp4';
    res.setHeader('Content-Type', contentType);

    if (streamData.contentLength) {
      res.setHeader('Content-Length', streamData.contentLength);
    }

    // Allow range requests for seeking
    res.setHeader('Accept-Ranges', 'bytes');

    // Use ytdl to create a readable stream (handles reconnection automatically)
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const agent = getAgent();

    // Build ytdl options to match the format we selected
    const dlOptions = {
      quality: 'highestaudio',
      filter: 'audioonly',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      },
    };
    if (agent) {
      dlOptions.agent = agent;
    }

    // Handle range requests for seeking support
    if (res.req.headers.range) {
      const range = res.req.headers.range;
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (match && streamData.contentLength) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : parseInt(streamData.contentLength, 10) - 1;
        const chunkSize = end - start + 1;

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${streamData.contentLength}`);
        res.setHeader('Content-Length', chunkSize);

        dlOptions.range = { start, end };
      }
    }

    const audioStream = ytdl(videoUrl, dlOptions);

    // Pipe audio data to HTTP response
    audioStream.pipe(res);

    // Handle stream errors
    audioStream.on('error', (err) => {
      console.error(`[stream proxy error] ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          data: null,
          error: `Stream proxy failed: ${err.message}`,
        });
      }
    });

    // Clean up if the client disconnects
    res.on('close', () => {
      audioStream.destroy();
    });
  } catch (err) {
    console.error(`[stream proxy error] ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        data: null,
        error: `Stream proxy failed: ${err.message}`,
      });
    }
  }
}

module.exports = { getStreamUrl, proxyStream };
