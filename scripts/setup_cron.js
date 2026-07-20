'use strict';

const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Try to load env variables
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function run() {
  console.log('=== cron-job.org Setup Tool ===\n');

  let apiKey = process.env.CRON_JOB_API_KEY;
  if (!apiKey) {
    apiKey = await askQuestion('Please enter your cron-job.org API Key (Bearer token): ');
    apiKey = apiKey.trim();
  }

  if (!apiKey) {
    console.error('Error: API Key is required.');
    rl.close();
    process.exit(1);
  }

  let renderUrl = process.env.RENDER_URL;
  if (!renderUrl) {
    renderUrl = await askQuestion('Please enter your Render API Health Check URL (default: https://meq3d-backend-yt-music.onrender.com/api/health): ');
    renderUrl = renderUrl.trim();
    if (!renderUrl) {
      renderUrl = 'https://meq3d-backend-yt-music.onrender.com/api/health';
    }
  }

  console.log(`\nConfigured parameters:`);
  console.log(`- URL to ping: ${renderUrl}`);
  console.log(`- Schedule: Every 14 minutes (Minutes: 0, 14, 28, 42, 56)`);
  console.log(`\nSending request to cron-job.org API...`);

  try {
    const response = await axios.put(
      'https://api.cron-job.org/jobs',
      {
        job: {
          title: 'Keep Render YouTube Music Backend Awake',
          url: renderUrl,
          enabled: true,
          saveResponses: false,
          schedule: {
            timezone: 'UTC',
            expiresAt: 0,
            hours: [-1],
            mdays: [-1],
            months: [-1],
            wdays: [-1],
            minutes: [0, 14, 28, 42, 56]
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    console.log('\nSUCCESS! Cron job has been created successfully.');
    console.log('Response from cron-job.org:', response.data);

    // Prompt user to save this to .env
    const saveToEnv = await askQuestion('\nWould you like to save these credentials to your .env file? (y/n): ');
    if (saveToEnv.toLowerCase().trim() === 'y' || saveToEnv.toLowerCase().trim() === 'yes') {
      const envPath = path.join(__dirname, '../.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }

      // Append or replace
      let updatedContent = envContent;
      if (updatedContent.includes('CRON_JOB_API_KEY')) {
        updatedContent = updatedContent.replace(/CRON_JOB_API_KEY\s*=\s*.*/g, `CRON_JOB_API_KEY = ${apiKey}`);
      } else {
        updatedContent += `\nCRON_JOB_API_KEY = ${apiKey}`;
      }

      if (updatedContent.includes('RENDER_URL')) {
        updatedContent = updatedContent.replace(/RENDER_URL\s*=\s*.*/g, `RENDER_URL = ${renderUrl}`);
      } else {
        updatedContent += `\nRENDER_URL = ${renderUrl}`;
      }

      // Clean up multiple newlines
      updatedContent = updatedContent.trim() + '\n';
      fs.writeFileSync(envPath, updatedContent, 'utf8');
      console.log('Credentials saved to .env.');
    }
  } catch (error) {
    console.error('\nERROR creating cron job:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  } finally {
    rl.close();
  }
}

run().catch(console.error);
