'use strict';

const axios = require('axios');
const {
  INNERTUBE_BASE_URL,
  INNERTUBE_API_KEY,
  INNERTUBE_CLIENT,
  INNERTUBE_HEADERS,
  SEARCH_FILTERS,
} = require('../config/constants');

/**
 * Build the base InnerTube request body with client context.
 * @param {object} [overrides] — additional top-level fields to merge
 * @returns {object}
 */
function buildRequestBody(overrides = {}) {
  return {
    context: {
      client: { ...INNERTUBE_CLIENT },
    },
    ...overrides,
  };
}

/**
 * Make a POST request to an InnerTube endpoint.
 * @param {string} endpoint — e.g. 'search', 'browse', 'next', 'player'
 * @param {object} body — the full request body
 * @returns {Promise<object>} — the parsed JSON response
 */
async function request(endpoint, body, cookie = null) {
  const url = `${INNERTUBE_BASE_URL}/${endpoint}?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
  const headers = { ...INNERTUBE_HEADERS };
  if (cookie) {
    headers['Cookie'] = cookie.replace(/^["']|["']$/g, '');
  }
  const { data } = await axios.post(url, body, {
    headers,
    timeout: 15000,
  });
  return data;
}

// ─── Public API Methods ───────────────────────────────────────────────

/**
 * Search YouTube Music.
 * @param {string} query — search term
 * @param {string} [filter] — one of: songs, albums, artists, playlists, videos
 * @param {string} [cookie] — optional client cookies to forward
 * @returns {Promise<object>} raw InnerTube response
 */
async function search(query, filter, cookie = null) {
  const body = buildRequestBody({ query });
  if (filter && SEARCH_FILTERS[filter]) {
    body.params = SEARCH_FILTERS[filter];
  }
  return request('search', body, cookie);
}

/**
 * Browse a page (home, album, artist, playlist, lyrics, etc.).
 * @param {string} browseId — e.g. 'FEmusic_home', 'MPREb_...' (album), 'UC...' (artist)
 * @param {string} [params] — optional additional params string
 * @param {string} [cookie] — optional client cookies to forward
 * @returns {Promise<object>} raw InnerTube response
 */
async function browse(browseId, params, cookie = null) {
  const body = buildRequestBody({ browseId });
  if (params) body.params = params;
  return request('browse', body, cookie);
}

/**
 * Get the "up next" / radio queue for a video.
 * @param {string} videoId
 * @param {string} [playlistId] — optional playlist context
 * @param {string} [cookie] — optional client cookies to forward
 * @returns {Promise<object>} raw InnerTube response
 */
async function next(videoId, playlistId, cookie = null) {
  const overrides = {
    videoId,
    isAudioOnly: true,
    enablePersistentPlaylistPanel: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
  };
  if (playlistId) overrides.playlistId = playlistId;
  const body = buildRequestBody(overrides);
  return request('next', body, cookie);
}

/**
 * Get player info (streams, metadata) for a video.
 * @param {string} videoId
 * @param {string} [cookie] — optional client cookies to forward
 * @returns {Promise<object>} raw InnerTube response
 */
async function player(videoId, cookie = null) {
  const body = buildRequestBody({
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  });
  return request('player', body, cookie);
}

/**
 * Get search suggestions / autocomplete.
 * @param {string} input — partial query
 * @param {string} [cookie] — optional client cookies to forward
 * @returns {Promise<object>} raw InnerTube response
 */
async function getSearchSuggestions(input, cookie = null) {
  const body = buildRequestBody({ input });
  return request('music/get_search_suggestions', body, cookie);
}

module.exports = {
  search,
  browse,
  next,
  player,
  getSearchSuggestions,
  // Expose for advanced usage / testing
  buildRequestBody,
  request,
};
