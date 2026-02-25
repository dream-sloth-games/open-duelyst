'use strict';

const readline = require('readline');
const blessed = require('blessed');

const sessionManager = require('../game/sessionManager');
const gameSocket = require('../network/gameSocket');
const InputController = require('./inputController');
const { renderBoard } = require('./boardRenderer');
const { renderHand } = require('./handRenderer');
const logPane = require('./logPane');
const { login } = require('../api/auth');
const { getDecks, createSinglePlayerGame } = require('../api/games');
const { joinMatchmakingQueue, getMatchmakingStatus, cancelMatchmaking } = require('../api/matchmaking');

class App {
  constructor() {
    this.screen = null;
    this.statusBox = null;
    this.boardBox = null;
    this.handBox = null;
    this.logBox = null;
    this.helpBox = null;
    this.inputController = null;
    this._statusMessage = '';
    this._gameMode = null; // 'sp' | 'mp'
    this._token = null;
    this._userId = null;
  }

  /**
   * Main entry point. Runs the pre-game flow (login, deck selection, game creation)
   * then starts the TUI.
   */
  async start() {
    // --- Pre-game flow using readline (before blessed takes over stdin) ---
    try {
      await this._preGameFlow();
    } catch (err) {
      console.error('\nFailed to start game:', err.message);
      process.exit(1);
    }
  }

  async _preGameFlow() {
    console.clear();
    this._printBanner();

    const { token, userId, username } = await this._promptLogin();
    this._token = token;
    this._userId = userId;
    console.log(`\nWelcome, ${username}!\n`);

    const mode = await this._promptGameMode();
    this._gameMode = mode;

    let gameData;
    let isSinglePlayer = true;

    if (mode === 'sp') {
      const decks = await this._fetchDecks(token);
      const deck = await this._promptDeckSelection(decks);
      const aiGeneralId = this._pickAiGeneral(deck);

      console.log('\nCreating single-player game…');
      gameData = await createSinglePlayerGame(token, deck.cards, aiGeneralId);
      console.log(`Game created: ${gameData.game_id}`);
      console.log(`You are Player ${gameData.is_player_1 ? '1' : '2'}`);
    } else {
      // Multiplayer matchmaking
      const decks = await this._fetchDecks(token);
      const deck = await this._promptDeckSelection(decks);

      console.log('\nJoining matchmaking queue…');
      await joinMatchmakingQueue(token, deck.cards, 'casual');

      gameData = await this._pollForMatch(token);
      isSinglePlayer = false;
    }

    // --- Set up the blessed TUI ---
    this._setupBlessedUI();
    this.setStatus('Connecting to game server…');
    this.screen.render();

    // --- Connect to game server ---
    let joinResponse;
    try {
      joinResponse = await gameSocket.connect(
        token,
        gameData.game_id,
        userId,
        gameData.game_server || null,
        isSinglePlayer,
      );
    } catch (err) {
      this.setStatus(`Connection failed: ${err.message}`);
      this.screen.render();
      throw err;
    }

    // --- Initialize the non-authoritative game session ---
    sessionManager.initFromJoinResponse(joinResponse, userId);

    // --- Wire game events to UI callbacks ---
    this._wireGameEvents();

    // --- Forward socket network_game_event to session manager ---
    gameSocket.on('network_game_event', (eventData) => {
      sessionManager.handleNetworkGameEvent(eventData);
    });

    gameSocket.on('disconnect', (reason) => {
      this.setStatus(`Disconnected: ${reason}`);
      this.render();
    });

    gameSocket.on('network_game_error', (data) => {
      this.setStatus(`Game error: ${data.message || JSON.stringify(data)}`);
      this.render();
    });

    // --- Handle mulligan (auto-accept starting hand) ---
    sessionManager.handleMulligan(gameSocket);

    // --- Attach input controller ---
    this.inputController = new InputController(sessionManager, gameSocket, this);
    this.inputController.attach(this.screen);

    // --- Initial render ---
    const turnMsg = sessionManager.gameSession.isMyTurn() ? 'YOUR TURN' : "Opponent's turn…";
    this.setStatus(turnMsg);
    this.render();

    logPane.log('Game started!');
  }

  // --- Blessed UI setup ---

  _setupBlessedUI() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Open-Duelyst',
      fullUnicode: true,
    });

    // Status bar: top 1 line
    this.statusBox = blessed.box({
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      content: '',
      tags: true,
      style: { fg: 'white', bg: 'blue', bold: true },
    });

    // Board: middle section
    // 9x5 grid: each row = 3 lines, + 6 borders = 21 lines total. Top border at row 1.
    this.boardBox = blessed.box({
      top: 1,
      left: 0,
      right: 0,
      height: 21,
      content: '',
      tags: false,
      style: { fg: 'white' },
    });

    // Help bar below the board
    this.helpBox = blessed.box({
      top: 22,
      left: 0,
      right: 0,
      height: 1,
      content: 'arrows/hjkl=move  enter=select  1-7=play card  e=end turn  esc=cancel  q=quit',
      tags: false,
      style: { fg: 'gray' },
    });

    // Hand panel: bottom left
    this.handBox = blessed.box({
      bottom: 0,
      left: 0,
      width: '60%',
      height: 10,
      label: ' Hand ',
      border: { type: 'line' },
      content: '',
      tags: false,
      style: { fg: 'white', border: { fg: 'cyan' }, label: { fg: 'cyan' } },
    });

    // Log panel: bottom right
    this.logBox = blessed.box({
      bottom: 0,
      right: 0,
      width: '40%',
      height: 10,
      label: ' Log ',
      border: { type: 'line' },
      content: '',
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      style: { fg: 'gray', border: { fg: 'cyan' }, label: { fg: 'cyan' } },
    });

    this.screen.append(this.statusBox);
    this.screen.append(this.boardBox);
    this.screen.append(this.helpBox);
    this.screen.append(this.handBox);
    this.screen.append(this.logBox);

    logPane.attach(this.logBox);
  }

  // --- Game event wiring ---

  _wireGameEvents() {
    sessionManager.onStep((event) => {
      logPane.logStep(event);
      this.render();
    });

    sessionManager.onGameOver((event) => {
      const gs = sessionManager.gameSession;
      const winner = safeGet(() => gs.getWinner(), null);
      const didWin = winner && winner.getOwnerId
        ? winner.getOwnerId() === this._userId
        : winner && winner.getPlayerId && winner.getPlayerId() === this._userId;

      this.setStatus(didWin ? '*** YOU WIN! *** (q to quit)' : '*** DEFEAT *** (q to quit)');
      logPane.log(didWin ? 'YOU WIN!' : 'You were defeated.');
      this.render();
    });

    sessionManager.onTurnChange(() => {
      const gs = sessionManager.gameSession;
      if (safeGet(() => gs.isMyTurn(), false)) {
        this.setStatus('YOUR TURN — select a unit or play a card');
        logPane.log('Your turn!');
      } else {
        this.setStatus("Opponent's turn…");
        logPane.log("Opponent's turn.");
      }
      this.render();
    });

    sessionManager.onInvalidAction((data) => {
      const msg = data.validationMessage || data.message || 'Invalid action';
      this.setStatus(`Invalid: ${msg}`);
      this.render();
    });
  }

  // --- Render ---

  render() {
    if (!this.screen) return;
    const gs = sessionManager.gameSession;
    if (!gs) return;

    // --- Status bar ---
    try {
      const myGeneral = safeGet(() => gs.getGeneralForMyPlayer(), null);
      const oppGeneral = safeGet(() => gs.getGeneralForPlayer(gs.getOpponentPlayer()), null);
      const myHP = safeGet(() => myGeneral && myGeneral.getHP(), '?');
      const oppHP = safeGet(() => oppGeneral && oppGeneral.getHP(), '?');
      const myPlayer = safeGet(() => gs.getMyPlayer(), null);
      const mana = myPlayer
        ? `${safeGet(() => myPlayer.getRemainingMana(), '?')}/${safeGet(() => myPlayer.getMaximumMana(), '?')}`
        : '?/?';
      const turnLabel = safeGet(() => gs.isMyTurn(), false) ? '[YOUR TURN]' : "[Opp's turn]";
      const ic = this.inputController;
      const stateLabel = ic ? `[${ic.getState()}]` : '';
      const statusLine = `HP: ${myHP}  Opp HP: ${oppHP}  Mana: ${mana}  ${turnLabel} ${stateLabel}  ${this._statusMessage}`;
      this.statusBox.setContent(statusLine);
    } catch (e) {
      this.statusBox.setContent(this._statusMessage);
    }

    // --- Board ---
    try {
      const board = gs.getBoard();
      const ic = this.inputController;
      const selectedPos = ic ? ic.getSelectedUnitPos() : null;
      const highlighted = ic ? ic.getHighlightedPositions() : [];
      const highlightType = ic ? ic.getHighlightType() : null;
      const cursor = ic ? ic.getCursor() : null;

      const boardStr = renderBoard(
        board, sessionManager.myPlayerId, selectedPos, highlighted, highlightType, cursor,
      );
      this.boardBox.setContent(boardStr);
    } catch (e) {
      this.boardBox.setContent(`(board render error: ${e.message})`);
    }

    // --- Hand ---
    try {
      const myPlayer = gs.getMyPlayer();
      const ic = this.inputController;
      const selectedIdx = ic ? ic.getSelectedHandIndex() : null;
      this.handBox.setContent(renderHand(myPlayer, selectedIdx));
    } catch (e) {
      this.handBox.setContent('(hand unavailable)');
    }

    this.screen.render();
  }

  setStatus(msg) {
    this._statusMessage = msg;
  }

  // --- Pre-game flow helpers ---

  _printBanner() {
    console.log('╔══════════════════════════════════╗');
    console.log('║      Open-Duelyst Terminal       ║');
    console.log('╚══════════════════════════════════╝');
    console.log();
  }

  async _promptLogin() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (q) => new Promise((r) => rl.question(q, r));

    let result;
    while (true) {
      const username = (await question('Username: ')).trim();
      const password = (await question('Password: ')).trim();
      try {
        result = await login(username, password);
        break;
      } catch (err) {
        console.log(`Login failed: ${err.message}. Please try again.\n`);
      }
    }
    rl.close();
    return result;
  }

  async _promptGameMode() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (q) => new Promise((r) => rl.question(q, r));

    console.log('Game mode:');
    console.log('  1) Single player vs AI');
    console.log('  2) Multiplayer (PvP matchmaking)');
    const choice = (await question('Select [1/2]: ')).trim();
    rl.close();
    return choice === '2' ? 'mp' : 'sp';
  }

  async _fetchDecks(token) {
    let decks;
    try {
      decks = await getDecks(token);
    } catch (err) {
      console.log(`Could not load decks: ${err.message}`);
      decks = [];
    }
    return Array.isArray(decks) ? decks : [];
  }

  async _promptDeckSelection(decks) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (q) => new Promise((r) => rl.question(q, r));

    if (decks.length === 0) {
      console.log('No decks found. A default starter deck will be used.');
      rl.close();
      return this._starterDeck();
    }

    console.log('\nYour decks:');
    decks.forEach((d, i) => {
      const name = d.name || `Deck ${i + 1}`;
      console.log(`  [${i + 1}] ${name}`);
    });
    const choice = parseInt((await question('Select deck number (default 1): ')).trim() || '1', 10);
    rl.close();

    const selected = decks[(choice - 1)] || decks[0];
    return selected;
  }

  _pickAiGeneral(deck) {
    // Pick an AI opponent general from a different faction if possible
    // Default to Faction 1 general (card ID 3 = Lyonar general by default SDK lookup)
    // A real implementation would offer a menu
    try {
      const SDK = require('app/sdk.coffee');
      const playerGeneralId = deck.cards && deck.cards[0] && deck.cards[0].id;
      // Choose a different faction's general
      const generalsByFaction = {
        1: SDK.Cards.Faction1.General,
        2: SDK.Cards.Faction2.General,
        3: SDK.Cards.Faction3.General,
        4: SDK.Cards.Faction4.General,
        5: SDK.Cards.Faction5.General,
        6: SDK.Cards.Faction6.General,
      };
      // Find a faction other than the player's faction
      for (let f = 1; f <= 6; f++) {
        const genId = generalsByFaction[f];
        if (genId && genId !== playerGeneralId) {
          return genId;
        }
      }
      return SDK.Cards.Faction2.General;
    } catch (e) {
      return 3; // Fallback hardcoded general ID
    }
  }

  _starterDeck() {
    // Minimal starter deck for when no decks are available
    // Structure expected by server: array of { id: cardId }
    return {
      name: 'Starter',
      cards: [
        { id: 1 }, // Faction 1 General placeholder
      ],
    };
  }

  async _pollForMatch(token) {
    console.log('Waiting for opponent…');
    const maxAttempts = 60; // 60 seconds
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(1000);
      process.stdout.write('.');
      try {
        const status = await getMatchmakingStatus(token);
        if (status && status.game_id) {
          console.log(`\nMatch found! Game: ${status.game_id}`);
          return status;
        }
      } catch (e) {
        // Keep polling
      }
    }
    throw new Error('Matchmaking timed out after 60 seconds');
  }
}

function safeGet(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = new App();
