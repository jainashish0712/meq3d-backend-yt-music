'use strict';

const { Router } = require('express');
const innertube = require('../lib/innertubeClient');
const { parseSearchResponse } = require('../parsers/responseParser');
const { asyncHandler, createHttpError } = require('../middleware/errorHandler');

const router = Router();

/**
 * GET /api/search?q={query}&filter={songs|albums|artists|playlists|videos}
 *
 * Search YouTube Music. Optionally filter by content type.
 */
router.get('/', asyncHandler(async (req, res) => {
  const { q, filter } = req.query;

  if (!q || !q.trim()) {
    throw createHttpError(400, 'Query parameter "q" is required');
  }

  const validFilters = ['songs', 'albums', 'artists', 'playlists', 'videos'];
  if (filter && !validFilters.includes(filter)) {
    throw createHttpError(400, `Invalid filter. Must be one of: ${validFilters.join(', ')}`);
  }

  // Extract YouTube cookies from standard Cookie header or custom headers sent by the frontend
  const clientCookie = req.headers.cookie || req.headers['x-youtube-cookies'] || req.headers['x-youtube-cookie'] || null;

  const rawResponse = await innertube.search(q.trim(), filter || null, clientCookie);
  const results = parseSearchResponse(rawResponse);

  res.json({
    success: true,
    data: {
      query: q.trim(),
      filter: filter || 'all',
      resultCount: results.length,
      results,
    },
    error: null,
  });
}));

module.exports = router;
