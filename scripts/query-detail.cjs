const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const key = JSON.parse(fs.readFileSync('C:/Users/Swaya/.gemini/gsc-key.json', 'utf8'));

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
      res.on('end', () => resolve(JSON.parse(data).access_token));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function query(token, body) {
  const encodedSite = encodeURIComponent('sc-domain:quietjson.com');
  const postData = JSON.stringify(body);

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
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const token = await getAccessToken();
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDateObj = new Date();
  startDateObj.setDate(startDateObj.getDate() - 90);
  const startDate = startDateObj.toISOString().split('T')[0];

  const res = await query(token, {
    startDate,
    endDate,
    dimensions: ['query', 'country', 'date'],
    dimensionFilterGroups: [{
      filters: [{
        dimension: 'query',
        operator: 'equals',
        expression: 'json validator online'
      }]
    }]
  });

  console.log('Query detail for "json validator online":', JSON.stringify(res, null, 2));
}

main().catch(console.error);
