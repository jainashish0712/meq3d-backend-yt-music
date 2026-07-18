'use strict';

const { Router } = require('express');
const { asyncHandler, createHttpError } = require('../middleware/errorHandler');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execPromise = util.promisify(exec);
const router = Router();

/**
 * GET /api/streamfile/:videoId
 *
 * Downloads and extracts audio as M4A using yt-dlp, then sends the M4A file directly in the response.
 */
router.get('/:videoId', asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw createHttpError(400, 'Invalid video ID. Must be an 11-character YouTube video ID.');
  }

  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `${videoId}.m4a`);
  
  // Clean up any existing file
  if (fs.existsSync(tempFilePath)) {
    try {
      fs.unlinkSync(tempFilePath);
    } catch (e) {}
  }

  // Determine yt-dlp path from environment
  let ytDlpPath = process.env.YT_DLP_PATH || 'yt-dlp';
  // Remove any surrounding quotes from the path
  ytDlpPath = ytDlpPath.replace(/^["']|["']$/g, '');

  try {
    // Run yt-dlp command to extract audio as m4a
    const command = `"${ytDlpPath}" -f "bestaudio[ext=m4a][abr<=128]/bestaudio[ext=m4a]" --extract-audio --audio-format m4a -o "${tempFilePath}" "https://music.youtube.com/watch?v=${videoId}"`;
    await execPromise(command);

    // Robust file path detection
    let finalPath = tempFilePath;
    if (!fs.existsSync(finalPath)) {
      if (fs.existsSync(tempFilePath + '.m4a')) {
        finalPath = tempFilePath + '.m4a';
      } else {
        const files = fs.readdirSync(tempDir);
        const matchedFile = files.find(f => f.startsWith(videoId));
        if (matchedFile) {
          finalPath = path.join(tempDir, matchedFile);
        } else {
          throw new Error('Downloaded file not found after extraction');
        }
      }
    }

    // Send the file as an attachment
    res.download(finalPath, `${videoId}.m4a`, (err) => {
      // Clean up temp files
      try {
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }
        if (finalPath !== tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (e) {
        console.warn('[streamfile] Failed to delete temp file:', e.message);
      }

      if (err) {
        console.error('[streamfile] Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).send('Error downloading file');
        }
      }
    });

  } catch (err) {
    console.error(`[streamfile] Error downloading/extracting audio for ${videoId}:`, err);
    
    // Clean up temp files on error
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }
    if (fs.existsSync(tempFilePath + '.m4a')) {
      try {
        fs.unlinkSync(tempFilePath + '.m4a');
      } catch (e) {}
    }

    res.status(500).json({
      success: false,
      data: null,
      error: `Audio extraction failed: ${err.message}`,
    });
  }
}));

module.exports = router;
