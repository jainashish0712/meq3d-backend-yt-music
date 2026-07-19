'use strict';

const { Router } = require('express');
const { getStreamUrl, proxyStream } = require('../lib/streamExtractor');
const { asyncHandler, createHttpError } = require('../middleware/errorHandler');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cache = require('../lib/cache');
const { DEFAULT_CACHE_TTL } = require('../config/constants');

const router = Router();

/**
 * Fallback to yt-dlp to extract direct playable audio stream URL.
 */
async function getStreamUrlFallbackWithYtDlp(videoId, clientCookie) {
  return new Promise((resolve, reject) => {
    let ytDlpPath = process.env.YT_DLP_PATH || 'yt-dlp';
    ytDlpPath = ytDlpPath.replace(/^["']|["']$/g, '');

    let tempCookiesFile = null;
    if (clientCookie) {
      const { getCookiesFilePath } = require('../lib/cookieHelper');
      tempCookiesFile = getCookiesFilePath(clientCookie);
    }

    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const args = [];
    if (tempCookiesFile) {
      args.push('--cookies', tempCookiesFile);
    }

    const cacheDir = path.join(tempDir, '.cache');
    args.push('--cache-dir', cacheDir);
    args.push('--remote-components', 'ejs:github');

    if (process.env.YT_PROXY) {
      const cleanProxy = process.env.YT_PROXY.replace(/^["']|["']$/g, '');
      args.push('--proxy', cleanProxy);
    }

    args.push('--js-runtimes', `node:${process.execPath}`);

    let extractorArgs = [];
    if (process.env.YT_PO_TOKEN) {
      const cleanPoToken = process.env.YT_PO_TOKEN.replace(/^["']|["']$/g, '');
      if (process.env.YT_PLAYER_CLIENT) {
        const playerClient = process.env.YT_PLAYER_CLIENT.replace(/^["']|["']$/g, '');
        extractorArgs.push(`youtube:player_client=${playerClient};po_token=${cleanPoToken}`);
      } else {
        extractorArgs.push(`youtube:po_token=${cleanPoToken}`);
      }
    } else if (process.env.YT_PLAYER_CLIENT) {
      const playerClient = process.env.YT_PLAYER_CLIENT.replace(/^["']|["']$/g, '');
      extractorArgs.push(`youtube:player_client=${playerClient}`);
    }
    if (process.env.YT_EXTRACTOR_ARGS) {
      const cleanExtArgs = process.env.YT_EXTRACTOR_ARGS.replace(/^["']|["']$/g, '');
      extractorArgs.push(cleanExtArgs);
    }
    if (extractorArgs.length > 0) {
      args.push('--extractor-args', extractorArgs.join(';'));
    }

    args.push(
      '-j',
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      `https://www.youtube.com/watch?v=${videoId}`
    );

    console.log(`[stream route fallback] Spawning fallback yt-dlp with args:`, args);

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      // Clean up temp cookies file
      if (tempCookiesFile && fs.existsSync(tempCookiesFile)) {
        try {
          fs.unlinkSync(tempCookiesFile);
          console.log(`[stream route fallback] Temp cookies file deleted.`);
        } catch (e) {
          console.warn(`[stream route fallback] Failed to delete temp cookies file:`, e.message);
        }
      }

      if (err) {
        console.error(`[stream route fallback] yt-dlp failed:`, stderr || err.message);
        return reject(new Error(`yt-dlp extraction failed: ${stderr || err.message}`));
      }

      try {
        const json = JSON.parse(stdout);
        
        let format = 'audio/mp4';
        if (json.ext) {
          if (json.ext === 'webm') {
            format = 'audio/webm';
          } else if (json.ext === 'm4a') {
            format = 'audio/mp4';
          } else {
            format = `audio/${json.ext}`;
          }
        }

        const streamData = {
          streamUrl: json.url,
          format: format,
          bitrate: Math.round(json.abr || 0),
          contentLength: json.filesize || json.filesize_approx || null,
          durationMs: Math.round((json.duration || 0) * 1000),
          expiresIn: DEFAULT_CACHE_TTL,
        };

        // Cache the fallback result
        cache.set(`stream:${videoId}`, streamData, DEFAULT_CACHE_TTL);
        console.log(`[stream route fallback] Cached stream data for video ID: ${videoId}`);

        resolve(streamData);
      } catch (parseErr) {
        console.error(`[stream route fallback] Failed to parse JSON stdout:`, parseErr);
        reject(new Error(`Failed to parse yt-dlp output JSON`));
      }
    });
  });
}

/**
 * Custom proxy logic with yt-dlp fallback support.
 */
async function handleProxyStream(videoId, res, clientCookie) {
  try {
    let streamData;
    try {
      console.log(`[stream route proxy] Attempting format extraction via ytdl-core`);
      streamData = await getStreamUrl(videoId, clientCookie);
      console.log(`[stream route proxy] Successfully retrieved format via ytdl-core`);
    } catch (err) {
      console.warn(`[stream route proxy] ytdl-core failed: ${err.message}. Retrying with yt-dlp fallback...`);
      streamData = await getStreamUrlFallbackWithYtDlp(videoId, clientCookie);
    }

    const contentType = streamData.format || 'audio/mp4';
    res.setHeader('Content-Type', contentType);

    if (streamData.contentLength) {
      res.setHeader('Content-Length', streamData.contentLength);
    }

    res.setHeader('Accept-Ranges', 'bytes');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };

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

        headers['Range'] = `bytes=${start}-${end}`;
      }
    }

    console.log(`[stream route proxy] Piping stream from: ${streamData.streamUrl.substring(0, 60)}...`);

    const response = await axios({
      method: 'get',
      url: streamData.streamUrl,
      headers: headers,
      responseType: 'stream'
    });

    response.data.pipe(res);

    res.on('close', () => {
      if (response.data.destroy) {
        response.data.destroy();
      }
    });
  } catch (err) {
    console.error(`[stream route proxy error] ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        data: null,
        error: `Stream proxy failed: ${err.message}`,
      });
    }
  }
}

/**
 * GET /api/stream/:videoId
 *
 * Returns the best audio stream URL for a YouTube video.
 * Query params:
 *   ?proxy=true — pipe the audio through the server instead of returning the URL
 */
router.get('/:videoId', asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  console.log(`[stream route] Start: GET /api/stream/${videoId}`);

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    console.error(`[stream route] Invalid video ID: ${videoId}`);
    throw createHttpError(400, 'Invalid video ID. Must be an 11-character YouTube video ID.');
  }

  console.log(`[stream route] Validation passed for video ID: ${videoId}`);

  // Extract cookies from custom headers, fallback to local cookies.txt / cookies.json if present
  // Removing req.headers.cookie to avoid intercepting unrelated session cookies which would break the extractor
  let clientCookie = req.headers['x-youtube-cookies'] || req.headers['x-youtube-cookie'] || null;

  console.log(`[stream route] clientCookie from headers: ${!!clientCookie}`);

  if (!clientCookie) {
    console.log(`[stream route] No custom cookie header, falling back to streamExtractor's shared agent and cache`);
  } else {
    console.log(`[stream route] Using custom cookie from x-youtube-cookie headers`);
  }

  // Proxy mode: stream audio bytes through this server
  if (req.query.proxy === 'true') {
    console.log(`[stream route] Proxy mode enabled for video ID: ${videoId}`);
    return handleProxyStream(videoId, res, clientCookie);
  }

  console.log(`[stream route] Calling getStreamUrl for video ID: ${videoId}`);
  // Default: return the stream URL + metadata
  try {
    const streamData = await getStreamUrl(videoId, clientCookie);
    console.log(`[stream route] Successfully extracted stream data for video ID: ${videoId}`);
    res.json({
      success: true,
      data: streamData,
      error: null,
    });
  } catch (err) {
    console.warn(`[stream route] getStreamUrl failed for ${videoId}: ${err.message}. Initiating yt-dlp fallback...`);
    try {
      const streamData = await getStreamUrlFallbackWithYtDlp(videoId, clientCookie);
      console.log(`[stream route] Successfully extracted stream data via fallback for video ID: ${videoId}`);
      res.json({
        success: true,
        data: streamData,
        error: null,
      });
    } catch (fallbackErr) {
      const is429 = fallbackErr.message?.includes('429') || fallbackErr.message?.includes('Too Many');
      const statusCode = is429 ? 429 : 500;

      console.error(`[stream route] Fallback error for ${videoId}:`, fallbackErr.message);

      res.status(statusCode).json({
        success: false,
        data: null,
        error: is429
          ? 'YouTube rate limit hit. Please try again in a few seconds.'
          : `Stream extraction failed: ${fallbackErr.message}`,
      });
    }
  }
}));

module.exports = router;
