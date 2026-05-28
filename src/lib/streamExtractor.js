'use strict';

const ytdl = require('@distube/ytdl-core');
const cache = require('./cache');
const { DEFAULT_CACHE_TTL } = require('../config/constants');

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
  const info = await ytdl.getInfo(videoUrl);

  // 3. Check playability
  if (!info || !info.formats || info.formats.length === 0) {
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
 * This lets the mobile client stream audio without CORS/IP issues,
 * and provides proper Content-Type headers for ExoPlayer/AVPlayer.
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

    // Build ytdl options to match the format we selected
    const dlOptions = {
      quality: 'highestaudio',
      filter: 'audioonly',
    };

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
