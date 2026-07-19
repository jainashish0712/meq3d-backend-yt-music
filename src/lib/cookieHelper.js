'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Loads JSON cookies from cookies.json or YT_COOKIES env var,
 * converts them to Netscape cookies format, and saves them to a temporary file.
 * Returns the path to the temporary cookies file, or null if no cookies are configured.
 */
function getCookiesFilePath() {
  let cookies = null;

  // 1. Try reading cookies.json from project root
  try {
    const cookiesPath = path.join(__dirname, '../../cookies.json');
    if (fs.existsSync(cookiesPath)) {
      const fileContent = fs.readFileSync(cookiesPath, 'utf8');
      cookies = JSON.parse(fileContent);
    }
  } catch (e) {
    // Silent fail
  }

  // 2. Fallback to YT_COOKIES env var
  if (!cookies) {
    const cookiesEnv = process.env.YT_COOKIES;
    if (cookiesEnv) {
      try {
        cookies = JSON.parse(cookiesEnv);
      } catch (e) {
        console.warn('[cookies] Failed to parse YT_COOKIES env var:', e.message);
      }
    }
  }

  if (!cookies || !Array.isArray(cookies)) {
    return null;
  }

  // 3. Convert to Netscape cookie format
  let netscapeContent = '# Netscape HTTP Cookie File\n# http://curl.haxx.se/rfc/cookie_spec.html\n# This is a generated file! Do not edit.\n\n';
  
  for (const cookie of cookies) {
    const domain = cookie.domain || '.youtube.com';
    const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const cookiePath = cookie.path || '/';
    const secure = cookie.secure !== false ? 'TRUE' : 'FALSE';
    
    let expiration = cookie.expirationDate || cookie.expiry;
    if (expiration === undefined) {
      expiration = Math.floor(Date.now() / 1000) + 31536000;
    } else if (expiration < 100000000000) {
      // already in seconds
    } else {
      // in milliseconds, convert to seconds
      expiration = Math.floor(expiration / 1000);
    }
    
    const name = cookie.name;
    const value = cookie.value;
    
    if (name && value !== undefined) {
      netscapeContent += `${domain}\t${flag}\t${cookiePath}\t${secure}\t${expiration}\t${name}\t${value}\n`;
    }
  }

  // Write to temporary cookies.txt file
  try {
    const tempDir = process.env.NETLIFY || process.env.LAMBDA_TASK_ROOT 
      ? '/tmp' 
      : path.join(__dirname, '../../temp');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempCookiesFile = path.join(tempDir, `cookies_${Date.now()}_${Math.floor(Math.random() * 1000)}.txt`);
    fs.writeFileSync(tempCookiesFile, netscapeContent, 'utf8');
    return tempCookiesFile;
  } catch (err) {
    console.error('[cookies] Failed to write temporary Netscape cookies file:', err.message);
    return null;
  }
}

module.exports = { getCookiesFilePath };
