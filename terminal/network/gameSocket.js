'use strict';

const io = require('socket.io-client');

// Event type constants matching server protocol
const JOIN_GAME = 'join_game';
const JOIN_GAME_RESPONSE = 'join_game_response';
const CONNECTED = 'connected';
const NETWORK_GAME_EVENT = 'network_game_event';
const NETWORK_GAME_ERROR = 'network_game_error';

// SP server listens on port 8000, MP server on 8001
const SP_PORT = 8000;
const MP_PORT = 8001;

class GameSocket {
  constructor() {
    this.socket = null;
    this.gameId = null;
    this.playerId = null;
    this._listeners = new Map();
  }

  /**
   * Connect to the game server and join a game room.
   * Bypasses NetworkManager to avoid browser-specific dependencies.
   *
   * @param {string} token - JWT token (without 'Bearer ' prefix)
   * @param {string} gameId - The game ID returned by createSinglePlayerGame
   * @param {string} playerId - Our user ID (from JWT payload)
   * @param {string|null} gameServer - Game server hostname (null defaults to localhost)
   * @param {boolean} [isSinglePlayer=true] - true = port 8000, false = port 8001
   * @returns {Promise<Object>} Resolves with join_game_response payload
   */
  connect(token, gameId, playerId, gameServer, isSinglePlayer) {
    this.gameId = gameId;
    this.playerId = playerId;

    const host = gameServer || 'localhost';
    const port = (isSinglePlayer === false) ? MP_PORT : SP_PORT;
    const env = process.env.NODE_ENV || 'development';
    const protocol = env === 'development' ? 'ws' : 'wss';
    const url = `${protocol}://${host}:${port}`;

    return new Promise((resolve, reject) => {
      const socket = io(url, {
        auth: { token: `Bearer ${token}` },
        timeout: 20000,
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 20,
        transports: ['websocket'],
      });
      this.socket = socket;

      let joinResponseReceived = false;

      socket.on('connect_error', (err) => {
        if (!joinResponseReceived) {
          reject(new Error(`Socket connection error: ${err.message}`));
        }
      });

      // Server emits 'connected' after JWT auth passes
      socket.on(CONNECTED, () => {
        socket.emit(JOIN_GAME, { gameId, playerId });
      });

      // Server sends the full game state
      socket.on(JOIN_GAME_RESPONSE, (response) => {
        joinResponseReceived = true;
        if (response.error) {
          reject(new Error(`join_game_response error: ${response.error}`));
        } else {
          resolve(response);
        }
      });

      // Forward game events to internal listeners
      socket.on(NETWORK_GAME_EVENT, (eventData) => {
        this._emit(NETWORK_GAME_EVENT, eventData);
      });

      socket.on(NETWORK_GAME_ERROR, (errorData) => {
        this._emit(NETWORK_GAME_ERROR, errorData);
      });

      socket.on('disconnect', (reason) => {
        this._emit('disconnect', reason);
      });

      socket.on('player_joined', (pid) => {
        this._emit('player_joined', pid);
      });
    });
  }

  /**
   * Send a game action step to the server.
   * @param {Object} stepData - Serialized step object
   */
  sendStep(stepData) {
    if (this.socket && this.socket.connected) {
      this.socket.emit(NETWORK_GAME_EVENT, {
        type: 'step',
        step: stepData,
      });
    }
  }

  /**
   * Register a listener for a socket event.
   */
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
  }

  /**
   * Remove a listener for a socket event.
   */
  off(event, handler) {
    if (!this._listeners.has(event)) return;
    const handlers = this._listeners.get(event).filter((h) => h !== handler);
    this._listeners.set(event, handlers);
  }

  /**
   * Fire all listeners for an event.
   */
  _emit(event, data) {
    const handlers = this._listeners.get(event) || [];
    handlers.forEach((h) => {
      try { h(data); } catch (e) { /* ignore listener errors */ }
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.gameId = null;
    this.playerId = null;
    this._listeners.clear();
  }
}

// Export a singleton instance for the TUI session
module.exports = new GameSocket();
