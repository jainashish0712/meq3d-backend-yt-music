'use strict';

const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Only run on non-Windows (e.g. Render / Linux) or when NODE_ENV is production
if (os.platform() !== 'win32' || process.env.NODE_ENV === 'production') {
  const binDir = path.join(__dirname, '../bin');
  const ytDlpPath = path.join(binDir, 'yt-dlp');
  const ffmpegPath = path.join(binDir, 'ffmpeg');

  // Loop-prevention guard: skip if binaries are already installed
  if (fs.existsSync(ytDlpPath) && fs.existsSync(ffmpegPath)) {
    console.log('==> yt-dlp and ffmpeg binaries already exist. Skipping installation.');
    process.exit(0);
  }

  console.log('==> Running postinstall script to fetch binaries...');
  try {
    const buildScriptPath = path.join(__dirname, '../render-build.sh');
    if (fs.existsSync(buildScriptPath)) {
      // Set IS_POSTINSTALL env var to prevent infinite recursion
      execSync(`chmod +x "${buildScriptPath}" && "${buildScriptPath}"`, {
        stdio: 'inherit',
        env: { ...process.env, IS_POSTINSTALL: 'true' }
      });
    } else {
      console.warn('==> render-build.sh not found');
    }
  } catch (err) {
    console.error('==> render-build.sh failed:', err.message);
    process.exit(1);
  }
} else {
  console.log('==> Skipping postinstall on Windows local development.');
}
