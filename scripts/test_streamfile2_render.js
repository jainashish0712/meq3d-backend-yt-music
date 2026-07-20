const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Simulate Render.com environment by setting environment variables
process.env.PORT = 3006;
process.env.RENDER = 'true';

// Import the app (starts the Express server)
console.log('Starting Render-simulated test server on port 3006...');
const app = require('../src/app');

// Wait 1.5 seconds for server to start
setTimeout(() => {
  runTests().catch(err => {
    console.error('Render Test suite failed:', err);
    process.exit(1);
  });
}, 1500);

async function runTests() {
  const videoId = 'cuMuMnCRfqk';
  const url = `http://127.0.0.1:3006/api/streamfile2/${videoId}`;
  
  // Clean up any existing temp files to ensure a fresh download is triggered
  const tempFile = path.join(__dirname, '../temp', `${videoId}.m4a`);
  if (fs.existsSync(tempFile)) {
    try {
      fs.unlinkSync(tempFile);
      console.log('Cleaned up existing temp file before test run.');
    } catch (e) {}
  }

  console.log('Triggering concurrent test requests in Render simulation mode...');
  
  let req1Done = false;
  let req2Done = false;

  // Request 1: We will abort it as soon as we start receiving data chunks
  const p1 = new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      console.log(`[Req 1] Response received. Status: ${res.statusCode}`);
      assert.strictEqual(res.statusCode, 200);
      
      res.on('data', (chunk) => {
        console.log(`[Req 1] Received chunk (${chunk.length} bytes). Aborting request...`);
        req.destroy(); // Simulate browser client abort
        req1Done = true;
        resolve();
      });
    });
    
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || req.destroyed) {
        console.log('[Req 1] Aborted connection clean-up successful.');
        req1Done = true;
        resolve();
      } else {
        reject(err);
      }
    });
  });

  // Request 2: Starts 500ms later to simulate Chrome range pre-fetch connection hand-off.
  const p2 = new Promise((resolve, reject) => {
    setTimeout(() => {
      console.log('[Req 2] Starting concurrent request...');
      const reqStart = Date.now();
      
      const req = http.get(url, (res) => {
        const ytDlpTime = parseInt(res.headers['x-ytdlp-time'], 10);
        console.log(`[Req 2] Response received. Status: ${res.statusCode}. Latency: ${Date.now() - reqStart}ms. X-Ytdlp-Time: ${ytDlpTime}ms`);
        assert.strictEqual(res.statusCode, 200);
        
        // Assert that Render-optimized fallback flow executes successfully.
        // On Render, the cold start JS compilation takes around 3.5s, but warm run takes < 2.5s.
        // We enforce a 5-second assertion here to tolerate the initial extraction overhead on cloud instances.
        assert.ok(!isNaN(ytDlpTime) && ytDlpTime <= 5000, `yt-dlp task took ${ytDlpTime}ms, exceeding Render limit`);
        
        let bytesReceived = 0;
        res.on('data', (chunk) => {
          bytesReceived += chunk.length;
        });
        
        res.on('end', () => {
          const latency = Date.now() - reqStart;
          console.log(`[Req 2] Request finished successfully. Received ${bytesReceived} bytes. Latency: ${latency}ms`);
          assert.ok(latency <= 6000, `Response time of ${latency}ms exceeded Render 6000ms limit`);
          assert.ok(bytesReceived > 0, 'Should receive audio bytes');
          req2Done = true;
          resolve();
        });
      });
      
      req.on('error', reject);
    }, 500);
  });

  await Promise.all([p1, p2]);

  assert.ok(req1Done, 'Request 1 should have been executed and aborted');
  assert.ok(req2Done, 'Request 2 should have completed successfully');

  console.log('\n======================================');
  console.log(' Render test suite passed successfully!');
  console.log('======================================\n');
  
  process.exit(0);
}
