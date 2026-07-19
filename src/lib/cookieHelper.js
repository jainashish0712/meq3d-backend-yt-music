'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parses a cookie string or JSON array into an array of cookie objects.
 * Supports:
 * 1. JSON array format: [{"name": "foo", "value": "bar"}, ...]
 * 2. Raw Cookie Header format: "name1=value1; name2=value2"
 */
function parseCookies(content) {
  if (!content) return null;
  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      console.warn('[cookies] Failed to parse cookies as JSON array:', e.message);
    }
  }

  // Fallback: parse as standard raw cookie string
  try {
    const cookies = [];
    const pairs = trimmed.split(';');
    for (let pair of pairs) {
      const trimmedPair = pair.trim();
      if (!trimmedPair) continue;
      const index = trimmedPair.indexOf('=');
      if (index === -1) continue;
      const name = trimmedPair.substring(0, index).trim();
      const value = trimmedPair.substring(index + 1).trim();
      if (name) {
        cookies.push({
          name,
          value,
          domain: '.youtube.com',
          path: '/',
          secure: true
        });
      }
    }
    return cookies.length > 0 ? cookies : null;
  } catch (e) {
    console.warn('[cookies] Failed to parse raw cookie string:', e.message);
    return null;
  }
}

/**
 * Loads cookies from customCookie, cookies.json, or YT_COOKIES env var,
 * converts them to Netscape cookies format, and saves them to a temporary file.
 * Returns the path to the temporary cookies file, or null if no cookies are configured.
 * @param {string} [customCookie] — custom cookies to use for this request
 */
function getCookiesFilePath(customCookie = null) {
  let cookies = null;

  if (customCookie) {
    cookies = parseCookies(customCookie);
  }

  // 1. Try reading cookies.json from project root
  if (!cookies) {
    try {
      const cookiesPath = path.join(__dirname, '../../cookies.json');
      if (fs.existsSync(cookiesPath)) {
        const fileContent = fs.readFileSync(cookiesPath, 'utf8');
        cookies = parseCookies(fileContent);
      }
    } catch (e) {
      // Silent fail
    }
  }

  // 2. Fallback to YT_COOKIES env var
  if (!cookies) {
    const cookiesEnv = process.env.YT_COOKIES;
    if (cookiesEnv) {
      try {
        cookies = parseCookies(cookiesEnv);
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
