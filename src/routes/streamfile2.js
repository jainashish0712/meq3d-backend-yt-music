'use strict';

const { Router } = require('express');
const { spawn } = require('child_process');
const { getCookiesFilePath } = require('../lib/cookieHelper');
const fs = require('fs');
const path = require('path');

const router = Router();

// Registry of active video download promises to prevent concurrent duplicate calls for the same ID
const activeDownloads = new Map();

/**
 * Sends the downloaded file to the client and schedules a delayed cleanup
 */
function serveDownloadedFile(finalPath, videoId, res, startTime, ytDlpTime) {
  console.log(`[streamfile2] [${videoId}] Initiating stream response for path: ${finalPath}`);
  
  // Set the custom header representing the yt-dlp task duration
  if (ytDlpTime !== undefined) {
    res.set('X-Ytdlp-Time', ytDlpTime.toString());
  }

  const downloadStart = Date.now();
  res.sendFile(finalPath, (err) => {
    const downloadTime = Date.now() - downloadStart;
    console.log(`[streamfile2] [${videoId}] res.sendFile callback completed in ${downloadTime}ms. Error: ${err ? err.message : 'none'}`);
    console.log(`[streamfile2] [${videoId}] Total request duration: ${Date.now() - startTime}ms`);
    
    // Register delayed cleanup instead of unlinking immediately
    // This allows browser Range requests/retries to hit the disk cache instantly
    setTimeout(() => {
      try {
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
          console.log(`[streamfile2] [${videoId}] Auto-cleaned temp file: ${finalPath}`);
        }
      } catch (e) {
        console.warn(`[streamfile2] [${videoId}] Failed to clean up temp file:`, e.message);
      }
    }, 5 * 60 * 1000); // Keep for 5 minutes
  });
}

router.get('/:videoId', async (req, res) => {
  const startTime = Date.now();
  const { videoId } = req.params;
  const tempDir = path.join(__dirname, '../../temp');
  const tempFilePath = path.join(tempDir, `${videoId}.m4a`);

  console.log(`[streamfile2] [${videoId}] Start: GET /api/streamfile2/${videoId}`);

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 1. If the file already exists on disk and is not actively downloading, serve it directly
  if (fs.existsSync(tempFilePath) && !activeDownloads.has(videoId)) {
    console.log(`[streamfile2] [${videoId}] Completed file found at ${tempFilePath}. Serving directly.`);
    return serveDownloadedFile(tempFilePath, videoId, res, startTime, 0);
  }

  // 2. If download is already in progress, wait for it and serve
  if (activeDownloads.has(videoId)) {
    console.log(`[streamfile2] [${videoId}] Download already in progress. Waiting...`);
    try {
      const { finalPath, ytDlpTime } = await activeDownloads.get(videoId);
      console.log(`[streamfile2] [${videoId}] Wait finished for active download. Serving file.`);
      return serveDownloadedFile(finalPath, videoId, res, startTime, ytDlpTime);
    } catch (err) {
      if (!res.headersSent) {
        return res.status(500).json({ error: `yt-dlp failed: ${err.message}` });
      }
      return;
    }
  }

  // Get cookies file path dynamically from standard config
  const tempCookiesFile = getCookiesFilePath();

  // Create Python wrapper dynamically for bypassing sleep in fallback mode
  const wrapperPath = path.join(tempDir, 'yt_dlp_wrapper.py');
  if (!fs.existsSync(wrapperPath)) {
    const wrapperCode = `
import sys
import yt_dlp

orig_YoutubeDL = yt_dlp.YoutubeDL
class MyYoutubeDL(orig_YoutubeDL):
    def process_info(self, info_dict):
        info_dict.pop('available_at', None)
        if 'requested_formats' in info_dict:
            for f in info_dict['requested_formats']:
                f.pop('available_at', None)
        return orig_YoutubeDL.process_info(self, info_dict)

yt_dlp.YoutubeDL = MyYoutubeDL

if __name__ == '__main__':
    yt_dlp.main()
`;
    fs.writeFileSync(wrapperPath, wrapperCode.trim(), 'utf8');
  }

  // Find Python bin matching current execution environment path
  let pythonBin = process.platform === 'win32' ? 'python' : 'python3';
  if (process.env.YT_DLP_PATH) {
    try {
      const binDir = path.dirname(process.env.YT_DLP_PATH);
      const winPy = path.join(binDir, 'python.exe');
      const nixPy = path.join(binDir, 'python3');
      const nixPy2 = path.join(binDir, 'python');
      if (fs.existsSync(winPy)) pythonBin = winPy;
      else if (fs.existsSync(nixPy)) pythonBin = nixPy;
      else if (fs.existsSync(nixPy2)) pythonBin = nixPy2;
    } catch (e) {}
  }

  const runDownloadTask = (useCookies, registerChild) => {
    return new Promise((resolve, reject) => {
      const args = [];
      if (useCookies && tempCookiesFile) {
        args.push('--cookies', tempCookiesFile);
      }

      const cacheDir = path.join(tempDir, '.cache');
      args.push('--cache-dir', cacheDir);
      args.push('--no-plugin-dirs');
      args.push('--no-playlist');
      args.push('--no-check-certificate');
      args.push('--remote-components', 'ejs:github');

      if (useCookies) {
        // Fallback uses web_embedded with sleep bypass wrapper and skips webpage download to optimize speed
        args.push('--extractor-args', 'youtube:playback_wait=0;player_client=web_embedded;player_skip=webpage');
      } else {
        // Primary run uses android_vr which does not require cookies/PO token/sleep wait
        args.push('--extractor-args', 'youtube:player_client=android_vr');
      }

      // Restrict JS runtimes strictly to Node from system PATH (avoids slow Deno compilation on cloud environments)
      args.push('--js-runtimes', 'node');

      args.push(
        '-f', 'bestaudio[ext=m4a][abr<=128]/bestaudio[ext=m4a]',
        '--extract-audio',
        '--audio-format', 'm4a',
        '-o', tempFilePath,
        `https://www.youtube.com/watch?v=${videoId}`
      );

      const bin = useCookies ? pythonBin : (process.env.YT_DLP_PATH || 'yt-dlp');
      const runArgs = useCookies ? [wrapperPath, ...args] : args;

      console.log(`[streamfile2] [${videoId}] Spawning yt-dlp (cookies=${useCookies})...`);
      const ytDlpStart = Date.now();
      const child = spawn(bin, runArgs);

      if (registerChild) {
        registerChild(child);
      }

      let stdoutRemainder = '';
      child.stdout.on('data', (data) => {
        stdoutRemainder += data.toString();
        const lines = stdoutRemainder.split(/[\r\n]+/);
        stdoutRemainder = lines.pop();
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[streamfile2] [${videoId}] [yt-dlp stdout] [+${Date.now() - ytDlpStart}ms] ${line.trim()}`);
          }
        }
      });

      let stderrRemainder = '';
      child.stderr.on('data', (data) => {
        stderrRemainder += data.toString();
        const lines = stderrRemainder.split(/[\r\n]+/);
        stderrRemainder = lines.pop();
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[streamfile2] [${videoId}] [yt-dlp stderr] [+${Date.now() - ytDlpStart}ms] ${line.trim()}`);
          }
        }
      });

      child.on('close', (code) => {
        const ytDlpTime = Date.now() - ytDlpStart;
        console.log(`[streamfile2] [${videoId}] yt-dlp (cookies=${useCookies}) finished in ${ytDlpTime}ms with exit code: ${code}`);

        if (code === 0 && fs.existsSync(tempFilePath)) {
          resolve(ytDlpTime);
        } else {
          try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}
          reject(new Error(`yt-dlp failed with code ${code}`));
        }
      });

      child.on('error', (err) => {
        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}
        reject(err);
      });
    });
  };

  // Wrap the download flow in a promise so concurrent requests can await it
  const downloadPromise = new Promise(async (resolve, reject) => {
    let resolved = false;
    let errors = [];
    const activeProcesses = [];

    const handleSuccess = (result) => {
      if (resolved) return;
      resolved = true;
      activeProcesses.forEach(child => {
        try { child.kill('SIGKILL'); } catch (e) {}
      });
      resolve(result);
    };

    const handleFailure = (err) => {
      errors.push(err);
      if (errors.length === 2 && !resolved) {
        reject(new Error(`Both download runs failed: ${errors.map(e => e.message).join('; ')}`));
      }
    };

    // Run both tasks concurrently and race them
    runDownloadTask(false, (child) => activeProcesses.push(child))
      .then(ytDlpTime => handleSuccess({ finalPath: tempFilePath, ytDlpTime }))
      .catch(handleFailure);

    runDownloadTask(true, (child) => activeProcesses.push(child))
      .then(ytDlpTime => handleSuccess({ finalPath: tempFilePath, ytDlpTime }))
      .catch(handleFailure);
  });

  activeDownloads.set(videoId, downloadPromise);

  try {
    const { finalPath, ytDlpTime } = await downloadPromise;
    activeDownloads.delete(videoId);
    serveDownloadedFile(finalPath, videoId, res, startTime, ytDlpTime);
  } catch (err) {
    activeDownloads.delete(videoId);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;
