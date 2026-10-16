const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const keyPath = 'C:/Users/Swaya/.gemini/gsc-key.json';
if (!fs.existsSync(keyPath)) {
  console.error('Key file not found at', keyPath);
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

function createJWT() {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signInput = `${b64Header}.${b64Payload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(key.private_key, 'base64url');

  return `${signInput}.${signature}`;
}

async function getAccessToken() {
  const jwt = createJWT();
  const postData = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(json);
        } catch (e) {
          reject(data);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function querySearchAnalytics(token, siteUrl, requestBody) {
  const encodedSite = encodeURIComponent(siteUrl);
  const postData = JSON.stringify(requestBody);

  return new Promise((resolve, reject) => {
    const req = https.request(`https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(data);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const token = await getAccessToken();
  const siteUrl = 'sc-domain:quietjson.com';

  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDateObj = new Date();
  startDateObj.setDate(startDateObj.getDate() - 90);
  const startDate = startDateObj.toISOString().split('T')[0];

  console.log(`\n======================================================`);
  console.log(`📊 QUIETJSON GOOGLE SEARCH CONSOLE AUDIT (${startDate} to ${endDate})`);
  console.log(`======================================================`);

  // Pull all top 250 queries with pages
  const result = await querySearchAnalytics(token, siteUrl, {
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    rowLimit: 250
  });

  if (!result.rows || result.rows.length === 0) {
    console.log('No rows returned.');
    return;
  }

  const rows = result.rows;
  console.log(`Total query-page combinations returned: ${rows.length}`);

  // 1. Group by Page
  const pageStats = {};
  rows.forEach(r => {
    const [query, page] = r.keys;
    if (!pageStats[page]) {
      pageStats[page] = { impressions: 0, clicks: 0, queries: [] };
    }
    pageStats[page].impressions += r.impressions;
    pageStats[page].clicks += r.clicks;
    pageStats[page].queries.push({ query, impressions: r.impressions, clicks: r.clicks, position: r.position });
  });

  console.log('\n--- PAGES RANKED BY IMPRESSIONS ---');
  const sortedPages = Object.entries(pageStats).sort((a, b) => b[1].impressions - a[1].impressions);
  sortedPages.forEach(([page, stats]) => {
    console.log(`\n🔗 ${page} | Total Impr: ${stats.impressions} | Clicks: ${stats.clicks} | Queries: ${stats.queries.length}`);
    // Top 5 queries for this page
    stats.queries
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5)
      .forEach(q => {
        console.log(`   - "${q.query}" -> Pos: ${q.position.toFixed(1)}, Impr: ${q.impressions}, Clicks: ${q.clicks}`);
      });
  });

  // 2. High Opportunity / Striking Distance Keywords (Pos <= 35)
  console.log('\n======================================================');
  console.log('🎯 STRIKING DISTANCE OPPORTUNITIES (Position 1.0 to 35.0)');
  console.log('======================================================');
  const striking = rows.filter(r => r.position <= 35).sort((a, b) => a.position - b.position);
  if (striking.length === 0) {
    console.log('No queries currently under position 35 in this sample.');
  } else {
    striking.forEach(r => {
      console.log(`[Pos ${r.position.toFixed(1).padStart(4)}] "${r.keys[0]}" | Impr: ${String(r.impressions).padStart(3)} | Clicks: ${r.clicks} | Page: ${r.keys[1]}`);
    });
  }
}

main().catch(console.error);
