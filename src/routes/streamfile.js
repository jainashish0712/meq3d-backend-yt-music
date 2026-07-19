'use strict';

const { Router } = require('express');
const { asyncHandler, createHttpError } = require('../middleware/errorHandler');
const { exec, spawn } = require('child_process');
const { getCookiesFilePath } = require('../lib/cookieHelper');
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

  console.log(`[streamfile] Start: GET /api/streamfile/${videoId}`);

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    console.error(`[streamfile] Validation failed: Invalid video ID "${videoId}"`);
    throw createHttpError(400, 'Invalid video ID. Must be an 11-character YouTube video ID.');
  }
  console.log(`[streamfile] Validation passed for video ID: ${videoId}`);

  const tempDir = path.join(__dirname, '../../temp');
  console.log(`[streamfile] Temp directory path: ${tempDir}`);
  if (!fs.existsSync(tempDir)) {
    console.log(`[streamfile] Creating temp directory: ${tempDir}`);
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempFilePath = path.join(tempDir, `${videoId}.m4a`);
  console.log(`[streamfile] Target temp file path: ${tempFilePath}`);
  
  // Clean up any existing file
  if (fs.existsSync(tempFilePath)) {
    console.log(`[streamfile] Found existing file at ${tempFilePath}, unlinking...`);
    try {
      fs.unlinkSync(tempFilePath);
      console.log(`[streamfile] Unlinked existing file successfully.`);
    } catch (e) {
      console.warn(`[streamfile] Failed to unlink existing file:`, e.message);
    }
  }

  // Determine yt-dlp path from environment
  let ytDlpPath = process.env.YT_DLP_PATH || 'yt-dlp';
  // Remove any surrounding quotes from the path
  ytDlpPath = ytDlpPath.replace(/^["']|["']$/g, '');
  console.log(`[streamfile] yt-dlp path: ${ytDlpPath}`);

  let tempCookiesFile = null;
  try {
    console.log(`[streamfile] Attempting to retrieve cookies file...`);
    tempCookiesFile = getCookiesFilePath();
    console.log(`[streamfile] Cookies file path: ${tempCookiesFile}`);

    const args = [];
    if (tempCookiesFile) {
      args.push('--cookies', tempCookiesFile);
    }

    // Add proxy option if configured in environment
    if (process.env.YT_PROXY) {
      const cleanProxy = process.env.YT_PROXY.replace(/^["']|["']$/g, '');
      console.log(`[streamfile] Using proxy: ${cleanProxy}`);
      args.push('--proxy', cleanProxy);
    }

    // Explicitly pass Node.js runtime location so yt-dlp can decrypt signatures successfully
    console.log(`[streamfile] JS Runtime (node): ${process.execPath}`);
    args.push('--js-runtimes', `node:${process.execPath}`);

    // Add client impersonation (requires curl-cffi)
    console.log('[streamfile] Using TLS impersonation: safari');
    args.push('--impersonate', 'safari');

    // Add extractor args option (useful for PO Token and client configuration)
    let extractorArgs = [];
    
    // Default player client to web_safari to bypass checks
    const playerClient = (process.env.YT_PLAYER_CLIENT || 'web_safari').replace(/^["']|["']$/g, '');
    
    // 1. If explicit PO Token environment variable is defined
    if (process.env.YT_PO_TOKEN) {
      const cleanPoToken = process.env.YT_PO_TOKEN.replace(/^["']|["']$/g, '');
      extractorArgs.push(`youtube:player_client=${playerClient};po_token=${cleanPoToken}`);
    } else {
      extractorArgs.push(`youtube:player_client=${playerClient}`);
    }
    
    // 2. If general/additional extractor arguments are defined
    if (process.env.YT_EXTRACTOR_ARGS) {
      const cleanExtArgs = process.env.YT_EXTRACTOR_ARGS.replace(/^["']|["']$/g, '');
      extractorArgs.push(cleanExtArgs);
    }
    
    // If any extractor args were constructed, push them to yt-dlp arguments
    if (extractorArgs.length > 0) {
      const joinedArgs = extractorArgs.join(';');
      console.log(`[streamfile] Using extractor-args: ${joinedArgs}`);
      args.push('--extractor-args', joinedArgs);
    }

    // Add other yt-dlp options
    args.push(
      '-f', 'bestaudio[ext=m4a][abr<=128]/bestaudio[ext=m4a]',
      '--extract-audio',
      '--audio-format', 'm4a',
      '-o', tempFilePath,
      `https://music.youtube.com/watch?v=${videoId}`
    );

    console.log(`[streamfile] Spawning yt-dlp with arguments:`, args);

    const child = spawn(ytDlpPath, args);

    child.stdout.on('data', (data) => {
      console.log(`[streamfile] [yt-dlp stdout]: ${data.toString().trim()}`);
    });

    child.stderr.on('data', (data) => {
      console.warn(`[streamfile] [yt-dlp stderr]: ${data.toString().trim()}`);
    });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        console.log(`[streamfile] yt-dlp exited with code: ${code}`);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`yt-dlp exited with code ${code}`));
        }
      });
      child.on('error', (err) => {
        console.error(`[streamfile] yt-dlp spawn/process error:`, err);
        reject(err);
      });
    });

    // Clean up cookies file immediately after yt-dlp finishes
    if (tempCookiesFile && fs.existsSync(tempCookiesFile)) {
      console.log(`[streamfile] Cleaning up temp cookies file: ${tempCookiesFile}`);
      try { 
        fs.unlinkSync(tempCookiesFile); 
        console.log(`[streamfile] Temp cookies file deleted.`);
      } catch (e) {
        console.warn(`[streamfile] Failed to delete temp cookies file:`, e.message);
      }
      tempCookiesFile = null;
    }

    // Robust file path detection
    console.log(`[streamfile] Detecting final downloaded file path...`);
    let finalPath = tempFilePath;
    if (!fs.existsSync(finalPath)) {
      console.log(`[streamfile] ${finalPath} does not exist directly. Checking alternative paths.`);
      if (fs.existsSync(tempFilePath + '.m4a')) {
        finalPath = tempFilePath + '.m4a';
        console.log(`[streamfile] Found file at: ${finalPath}`);
      } else {
        const files = fs.readdirSync(tempDir);
        const matchedFile = files.find(f => f.startsWith(videoId));
        if (matchedFile) {
          finalPath = path.join(tempDir, matchedFile);
          console.log(`[streamfile] Found matched file: ${finalPath}`);
        } else {
          console.error(`[streamfile] Downloaded file not found in ${tempDir} for ${videoId}`);
          throw new Error('Downloaded file not found after extraction');
        }
      }
    } else {
      console.log(`[streamfile] File exists at direct path: ${finalPath}`);
    }

    // Send the file as an attachment
    console.log(`[streamfile] Initiating download response for path: ${finalPath}`);
    res.download(finalPath, `${videoId}.m4a`, (err) => {
      // Clean up temp files
      console.log(`[streamfile] res.download callback triggered. Cleaning up temp files...`);
      try {
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
          console.log(`[streamfile] Cleaned up finalPath: ${finalPath}`);
        }
        if (finalPath !== tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log(`[streamfile] Cleaned up tempFilePath: ${tempFilePath}`);
        }
      } catch (e) {
        console.warn('[streamfile] Failed to delete temp file:', e.message);
      }

      if (err) {
        console.error('[streamfile] Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).send('Error downloading file');
        }
      } else {
        console.log(`[streamfile] Download completed successfully and response sent.`);
      }
    });

  } catch (err) {
    console.error(`[streamfile] Error downloading/extracting audio for ${videoId}:`, err);
    
    // Clean up cookies file if it wasn't cleaned up yet
    if (tempCookiesFile && fs.existsSync(tempCookiesFile)) {
      console.log(`[streamfile] Error fallback: Cleaning up temp cookies file: ${tempCookiesFile}`);
      try { fs.unlinkSync(tempCookiesFile); } catch (e) {}
    }

    // Clean up temp files on error
    if (fs.existsSync(tempFilePath)) {
      console.log(`[streamfile] Error fallback: Cleaning up tempFilePath: ${tempFilePath}`);
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }
    if (fs.existsSync(tempFilePath + '.m4a')) {
      console.log(`[streamfile] Error fallback: Cleaning up tempFilePath.m4a: ${tempFilePath + '.m4a'}`);
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
