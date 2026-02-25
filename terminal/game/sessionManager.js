'use strict';

// NOTE: SDK requires are deferred until after shims are installed.
// The caller (index.js) installs shims before requiring this module.

let SDK = null;
let Step = null;
let EVENTS = null;

function loadSDK() {
  if (!SDK) {
    SDK = require('app/sdk.coffee');
    Step = require('app/sdk/step');
    EVENTS = require('app/common/event_types');
  }
}

class SessionManager {
  constructor() {
    this.gameSession = null;
    this.myPlayerId = null;
    this._onStepCallback = null;
    this._onGameOverCallback = null;
    this._onTurnChangeCallback = null;
    this._onInvalidActionCallback = null;
  }

  /**
   * Initialize a non-authoritative GameSession from join_game_response data.
   * The server sends a scrubbed game state snapshot; we deserialize it here.
   *
   * @param {Object} joinResponse - The join_game_response from server
   * @param {string} myPlayerId - Our own player ID (from JWT)
   * @returns {GameSession}
   */
  initFromJoinResponse(joinResponse, myPlayerId) {
    loadSDK();
    this.myPlayerId = myPlayerId;

    // Reset any existing session and get a fresh singleton
    SDK.GameSession.reset();
    this.gameSession = SDK.GameSession.getInstance();

    // Non-authoritative mode: never call executeAction() locally;
    // we only process steps that come from the server.
    this.gameSession.setIsRunningAsAuthoritative(false);

    // Set our player ID so isMyTurn() / getMyPlayer() etc. work correctly
    this.gameSession.setUserId(myPlayerId);

    // Deserialize the server's scrubbed game state snapshot
    this.gameSession.deserializeSessionFromFirebase(joinResponse.gameSessionData);

    this._subscribeToSessionEvents();

    return this.gameSession;
  }

  /**
   * Process an incoming step event from the server.
   * @param {Object} eventData - { type: 'step', step: {...} }
   */
  handleNetworkGameEvent(eventData) {
    if (!this.gameSession) return;
    loadSDK();

    if (eventData.type === EVENTS.step) {
      try {
        const step = this.gameSession.deserializeStepFromFirebase(eventData.step);
        this.gameSession.executeAuthoritativeStep(step);
      } catch (err) {
        // Log but don't crash — the UI will show stale state
        process.stderr.write(`[sessionManager] Failed to execute step: ${err.message}\n`);
      }
    } else if (eventData.type === EVENTS.invalid_action) {
      if (this._onInvalidActionCallback) {
        this._onInvalidActionCallback(eventData);
      }
    }
  }

  /**
   * Validate and submit a player action to the server.
   * In non-authoritative mode we serialize the action into a Step and send it;
   * we never execute actions locally.
   *
   * @param {Action} action - SDK action object
   * @param {GameSocket} socket - The game socket connection
   * @returns {boolean} whether the action was valid and submitted
   */
  submitAction(action, socket) {
    if (!this.gameSession || !action) return false;
    loadSDK();

    // Local validation — server will re-validate authoritatively
    this.gameSession.validateAction(action);
    if (!action.getIsValid()) {
      return false;
    }

    // Build a (unsigned, non-authoritative) Step for this action
    const step = new Step(this.gameSession, action.getOwnerId());
    step.setAction(action);

    // Serialize and send to server
    const stepData = JSON.parse(this.gameSession.serializeToJSON(step));
    socket.sendStep(stepData);
    return true;
  }

  /**
   * Auto-accept the starting hand (no mulligan replacements).
   * Both players must send DrawStartingHandAction before the game becomes active.
   * @param {GameSocket} socket
   */
  handleMulligan(socket) {
    if (!this.gameSession) return;
    loadSDK();

    if (this.gameSession.isNew()) {
      const myPlayer = this.gameSession.getMyPlayer();
      if (myPlayer && !myPlayer.getHasStartingHand()) {
        // Pass empty array = keep all cards (no replacements)
        const action = myPlayer.actionDrawStartingHand([]);
        this.submitAction(action, socket);
      }
    }
  }

  /**
   * Subscribe to GameSession SDK events so the UI can react to game changes.
   */
  _subscribeToSessionEvents() {
    loadSDK();
    const eventBus = this.gameSession.getEventBus();

    eventBus.on(EVENTS.step, (event) => {
      if (this._onStepCallback) this._onStepCallback(event);
    });

    eventBus.on(EVENTS.game_over, (event) => {
      if (this._onGameOverCallback) this._onGameOverCallback(event);
    });

    eventBus.on(EVENTS.start_turn, (event) => {
      if (this._onTurnChangeCallback) this._onTurnChangeCallback(event);
    });
  }

  onStep(callback) { this._onStepCallback = callback; }
  onGameOver(callback) { this._onGameOverCallback = callback; }
  onTurnChange(callback) { this._onTurnChangeCallback = callback; }
  onInvalidAction(callback) { this._onInvalidActionCallback = callback; }
}

module.exports = new SessionManager();
