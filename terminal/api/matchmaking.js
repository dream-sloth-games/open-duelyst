'use strict';

const { httpGet, httpPost } = require('./auth');

const API_BASE = process.env.DUELYST_API || 'http://localhost:3000';

/**
 * Join the PvP matchmaking queue.
 * @param {string} token - JWT token
 * @param {Array} deck - array of { id: number } card objects
 * @param {string} gameType - game type string (e.g. 'ranked', 'casual')
 * @returns {Promise<Object>} matchmaking response
 */
async function joinMatchmakingQueue(token, deck, gameType) {
  return httpPost(
    `${API_BASE}/matchmaker/matchmaking`,
    { deck, game_type: gameType || 'ranked' },
    token,
  );
}

/**
 * Check current matchmaking status.
 * @param {string} token - JWT token
 * @returns {Promise<Object>} status object with game info if matched
 */
async function getMatchmakingStatus(token) {
  return httpGet(`${API_BASE}/matchmaker/matchmaking`, token);
}

/**
 * Cancel the current matchmaking search.
 * @param {string} token - JWT token
 */
async function cancelMatchmaking(token) {
  // DELETE is not in our httpGet/httpPost helpers; use a custom call
  const http = require('http');
  const https = require('https');
  const url = `${API_BASE}/matchmaker/matchmaking`;
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    };
    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { joinMatchmakingQueue, getMatchmakingStatus, cancelMatchmaking };
