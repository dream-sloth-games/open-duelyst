'use strict';

const http = require('http');
const https = require('https');

const API_BASE = process.env.DUELYST_API || 'http://localhost:3000';

/**
 * Make a JSON POST request.
 */
function httpPost(url, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers,
    };
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Make a JSON GET request with optional auth token.
 */
function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'GET',
      headers,
    };
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Login and return JWT token + user data.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{token: string, userId: string, username: string}>}
 */
async function login(username, password) {
  const result = await httpPost(`${API_BASE}/session/`, { username, password });
  if (!result.token) {
    throw new Error('Login failed: no token in response');
  }
  // Decode userId from JWT payload (base64 decode the middle segment)
  const payloadB64 = result.token.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  return {
    token: result.token,
    userId: payload.d.id,
    username: payload.d.username || username,
  };
}

module.exports = { login, httpPost, httpGet };
