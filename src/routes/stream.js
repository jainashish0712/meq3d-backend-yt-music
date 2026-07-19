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
    return proxyStream(videoId, res, clientCookie);
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
