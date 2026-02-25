'use strict';

const { httpGet, httpPost } = require('./auth');

const API_BASE = process.env.DUELYST_API || 'http://localhost:3000';

/**
 * Fetch the user's saved decks.
 * @param {string} token - JWT token
 * @returns {Promise<Array>} array of deck objects
 */
async function getDecks(token) {
  return httpGet(`${API_BASE}/api/me/decks`, token);
}

/**
 * Start a single-player game vs AI.
 * @param {string} token - JWT token
 * @param {Array} deck - array of { id: number } card objects (first is general)
 * @param {number} aiGeneralId - card ID of the AI opponent's general
 * @returns {Promise<Object>} { game_id, is_player_1, opponent_id, game_server, ... }
 */
async function createSinglePlayerGame(token, deck, aiGeneralId) {
  return httpPost(
    `${API_BASE}/api/me/games/single_player`,
    { deck, ai_general_id: aiGeneralId },
    token,
  );
}

module.exports = { getDecks, createSinglePlayerGame };
