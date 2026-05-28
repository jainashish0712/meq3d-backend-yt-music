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

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw createHttpError(400, 'Invalid video ID. Must be an 11-character YouTube video ID.');
  }

  // Proxy mode: stream audio bytes through this server
  if (req.query.proxy === 'true') {
    return proxyStream(videoId, res);
  }

  // Default: return the stream URL + metadata
  const streamData = await getStreamUrl(videoId);

  res.json({
    success: true,
    data: streamData,
    error: null,
  });
}));

module.exports = router;
