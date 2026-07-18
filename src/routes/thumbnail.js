'use strict';

const { Router } = require('express');
const axios = require('axios');
const innertube = require('../lib/innertubeClient');
const cache = require('../lib/cache');
const { asyncHandler, createHttpError } = require('../middleware/errorHandler');

const router = Router();

/**
 * GET /api/thumbnail/:songId
 *
 * Returns a high resolution cover image URL for the given song/video ID.
 * Response will only contain:
 * {
 *   "thumbnail": "high-res-thumbnail-url"
 * }
 */
router.get('/:songId', asyncHandler(async (req, res) => {
  const { songId } = req.params;

  if (!songId || !/^[a-zA-Z0-9_-]{11}$/.test(songId)) {
    throw createHttpError(400, 'Invalid song/video ID. Must be an 11-character YouTube ID.');
  }

  // 1. Check cache first
  const cacheKey = `thumbnail:${songId}`;
  const cachedUrl = cache.get(cacheKey);
  if (cachedUrl) {
    return res.json({ thumbnail: cachedUrl });
  }

  let highResUrl = null;

  // 2. Try head request on maxresdefault first as it is the highest quality (1280x720)
  try {
    const maxresUrl = `https://i.ytimg.com/vi/${songId}/maxresdefault.jpg`;
    const response = await axios.head(maxresUrl, { timeout: 3000 });
    if (response.status === 200) {
      highResUrl = maxresUrl;
    }
  } catch (err) {
    // If not found or failed, we will try alternative methods below
  }

  // 3. If maxresdefault wasn't available, try calling player API to see what YouTube returns
  if (!highResUrl) {
    try {
      const playerRes = await innertube.player(songId);
      const thumbnails = playerRes.videoDetails?.thumbnail?.thumbnails || [];
      if (thumbnails.length > 0) {
        // Sort descending by width
        const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
        let bestUrl = sorted[0].url;
        if (bestUrl.startsWith('//')) {
          bestUrl = `https:${bestUrl}`;
        }
        highResUrl = bestUrl;
      }
    } catch (err) {
      console.warn(`[thumbnail route] InnerTube player API call failed for ${songId}:`, err.message);
    }
  }

  // 4. Fallback sequence via HEAD requests (sddefault -> hqdefault)
  if (!highResUrl) {
    const fallbackUrls = [
      `https://i.ytimg.com/vi/${songId}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${songId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${songId}/default.jpg`
    ];

    for (const url of fallbackUrls) {
      try {
        const response = await axios.head(url, { timeout: 2000 });
        if (response.status === 200) {
          highResUrl = url;
          break;
        }
      } catch (err) {
        // Try next fallback
      }
    }
  }

  // 5. Ultimate fallback if absolutely everything fails
  if (!highResUrl) {
    highResUrl = `https://i.ytimg.com/vi/${songId}/hqdefault.jpg`;
  }

  // Cache for the same TTL as stream URLs (e.g. 4 hours)
  cache.set(cacheKey, highResUrl, 14400);

  res.json({
    thumbnail: highResUrl
  });
}));

module.exports = router;
