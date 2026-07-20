'use strict';

// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Automatically configure local bin and venv bin paths if they exist
const localBinPath = path.join(__dirname, '../bin');
const venvBinPath = path.join(__dirname, '../.venv/bin');

if (fs.existsSync(localBinPath)) {
  process.env.PATH = `${localBinPath}:${process.env.PATH}`;
}
if (fs.existsSync(venvBinPath)) {
  process.env.PATH = `${venvBinPath}:${process.env.PATH}`;
}

let foundYtDlp = null;
const ytDlpLocal = path.join(localBinPath, 'yt-dlp');
const ytDlpVenv = path.join(venvBinPath, 'yt-dlp');

if (fs.existsSync(ytDlpLocal)) {
  foundYtDlp = ytDlpLocal;
} else if (fs.existsSync(ytDlpVenv)) {
  foundYtDlp = ytDlpVenv;
}

if (foundYtDlp && !process.env.YT_DLP_PATH) {
  process.env.YT_DLP_PATH = foundYtDlp;
  console.log(`[system] Auto-configured YT_DLP_PATH to: ${foundYtDlp}`);
}

// Check and log cookie status at startup
const cookiesTxtPath = path.join(__dirname, '../cookies.txt');
const cookiesPath = path.join(__dirname, '../cookies.json');

if (fs.existsSync(cookiesTxtPath)) {
  console.log(`[system] Found cookies.txt at ${cookiesTxtPath} (Netscape format)`);
} else if (fs.existsSync(cookiesPath)) {
  try {
    const content = fs.readFileSync(cookiesPath, 'utf8');
    console.log(`[system] Found cookies.json at ${cookiesPath} (will be used for stream extraction and global fallback)`);
  } catch (e) {
    console.error(`[system] Error reading cookies.json: ${e.message}`);
  }
} else if (process.env.YT_COOKIES) {
  console.log('[system] YT_COOKIES environment variable is defined.');
} else {
  console.log('[system] No cookies.txt, cookies.json or YT_COOKIES found. Running in anonymous mode.');
}

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { errorHandler } = require('./middleware/errorHandler');

// ─── Import Route Modules ─────────────────────────────────────────────
const searchRoutes = require('./routes/search');
const streamRoutes = require('./routes/stream');
const streamFileRoutes = require('./routes/streamfile');
const streamFile2Routes = require('./routes/streamfile2');
const homeRoutes = require('./routes/home');
const albumRoutes = require('./routes/album');
const artistRoutes = require('./routes/artist');
const nextRoutes = require('./routes/next');
const suggestionsRoutes = require('./routes/suggestions');
const lyricsRoutes = require('./routes/lyrics');
const thumbnailRoutes = require('./routes/thumbnail');

// ─── Create Express App ───────────────────────────────────────────────
const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// ─── Global Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(morgan(process.env.LOG_LEVEL || 'dev'));

// ─── Health Check ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const binDir = path.join(__dirname, '../bin');
  const binExists = fs.existsSync(binDir);
  let binContents = [];
  if (binExists) {
    try {
      binContents = fs.readdirSync(binDir);
    } catch (e) {
      binContents = [e.message];
    }
  }

  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      debug: {
        ytDlpPathEnv: process.env.YT_DLP_PATH || null,
        pathEnv: process.env.PATH || null,
        binExists,
        ytDlpExists: fs.existsSync(path.join(binDir, 'yt-dlp')),
        binContents,
        cwd: process.cwd(),
        __dirname,
      }
    },
    error: null,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────
app.use('/api/search', searchRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/streamfile', streamFileRoutes);
app.use('/api/streamfile2', streamFile2Routes);
app.use('/api/home', homeRoutes);
app.use('/api/album', albumRoutes);
app.use('/api/artist', artistRoutes);
app.use('/api/next', nextRoutes);
app.use('/api/suggestions', suggestionsRoutes);
app.use('/api/lyrics', lyricsRoutes);
app.use('/api/thumbnail', thumbnailRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    data: null,
    error: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ─── Error Handler (must be last) ─────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   YouTube Music Backend API                      ║
  ║   Running on http://localhost:${PORT}               ║
  ╠══════════════════════════════════════════════════╣
  ║   Endpoints:                                     ║
  ║   GET /api/health          Health check           ║
  ║   GET /api/search          Search music           ║
  ║   GET /api/stream/:id      Audio stream URL       ║
  ║   GET /api/home            Home feed              ║
  ║   GET /api/album/:id       Album details          ║
  ║   GET /api/artist/:id      Artist page            ║
  ║   GET /api/next/:id        Up next queue          ║
  ║   GET /api/suggestions     Search suggestions     ║
  ║   GET /api/lyrics/:id      Song lyrics            ║
  ║   GET /api/thumbnail/:id   High-res thumbnail     ║
  ╚══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
