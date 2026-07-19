'use strict';

const { Router } = require('express');
const { getStreamUrl, proxyStream } = require('../lib/streamExtractor');
const { asyncHandler, createHttpError } = require('../middleware/errorHandler');

const router = Router();

/**
 * GET /api/stream/:videoId
 *
 * Returns the best audio stream URL for a YouTube video.
 * Query params:
 *   ?proxy=true — pipe the audio through the server instead of returning the URL
 */
router.get('/:videoId', asyncHandler(async (req, res) => {
  const { videoId } = req.params;


  console.log("20",);

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw createHttpError(400, 'Invalid video ID. Must be an 11-character YouTube video ID.');
  }

  // Extract cookies from request headers, fallback to local cookies.txt / cookies.json if present
  let clientCookie = req.headers.cookie || req.headers['x-youtube-cookies'] || req.headers['x-youtube-cookie'] || null;

  if (!clientCookie) {
    try {
      const fs = require('fs');
      const path = require('path');
      const cookiesTxtPath = path.join(__dirname, '../../cookies.txt');
      const cookiesJsonPath = path.join(__dirname, '../../cookies.json');
      if (fs.existsSync(cookiesTxtPath)) {
        clientCookie = fs.readFileSync(cookiesTxtPath, 'utf8');
        console.log('[stream route] Read cookies.txt content');
      } else if (fs.existsSync(cookiesJsonPath)) {
        clientCookie = fs.readFileSync(cookiesJsonPath, 'utf8');
        console.log('[stream route] Read cookies.json content:', clientCookie);
      } else {
        console.log('[stream route] cookies.txt or cookies.json not found');
      }
    } catch (e) {
      console.warn('[stream route] Failed to read cookies.txt / cookies.json:', e.message);
    }
  }

  // Proxy mode: stream audio bytes through this server
  if (req.query.proxy === 'true') {
    return proxyStream(videoId, res, clientCookie);
  }

  // Default: return the stream URL + metadata
  try {
    const streamData = await getStreamUrl(videoId, clientCookie);
    res.json({
      success: true,
      data: streamData,
      error: null,
    });
  } catch (err) {
    // Differentiate rate-limit errors from other errors
    const is429 = err.message?.includes('429') || err.message?.includes('Too Many');
    const statusCode = is429 ? 429 : 500;

    console.error(`[stream route] Error for ${videoId}:`, err.message);

    res.status(statusCode).json({
      success: false,
      data: null,
      error: is429
        ? 'YouTube rate limit hit. Please try again in a few seconds.'
        : `Stream extraction failed: ${err.message}`,
    });
  }
}));

module.exports = router;
