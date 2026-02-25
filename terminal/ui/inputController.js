'use strict';

const STATES = {
  IDLE: 'idle',
  UNIT_SELECTED: 'unit_selected',
  CARD_SELECTED: 'card_selected',
};

const BOARD_COLS = 9;
const BOARD_ROWS = 5;

class InputController {
  constructor(sessionManager, gameSocket, uiApp) {
    this.sessionManager = sessionManager;
    this.gameSocket = gameSocket;
    this.ui = uiApp;

    this.state = STATES.IDLE;
    this.cursor = { x: 0, y: 2 }; // Start at left middle (P1 general area)
    this.selectedUnitPos = null;   // Board position of selected unit
    this.selectedHandIndex = null; // Index in hand of selected card

    this.validMovePositions = [];
    this.validAttackPositions = [];
    this.validSummonPositions = [];
  }

  /**
   * Attach keyboard handlers to a blessed screen.
   * @param {Object} screen - blessed.Screen
   */
  attach(screen) {
    screen.key(['up', 'k'], () => this._moveCursor(0, -1));
    screen.key(['down', 'j'], () => this._moveCursor(0, 1));
    screen.key(['left', 'h'], () => this._moveCursor(-1, 0));
    screen.key(['right', 'l'], () => this._moveCursor(1, 0));

    screen.key(['enter', 'space'], () => this._confirm());
    screen.key(['escape'], () => this._cancel());
    screen.key(['e'], () => this._endTurn());
    screen.key(['q', 'C-c'], () => {
      this.gameSocket.disconnect();
      process.exit(0);
    });

    // Number keys 1-7 select cards from hand
    for (let i = 1; i <= 7; i++) {
      screen.key([String(i)], () => this._selectHandCard(i - 1));
    }
  }

  getCursor() { return { ...this.cursor }; }
  getState() { return this.state; }
  getSelectedUnitPos() { return this.selectedUnitPos; }
  getSelectedHandIndex() { return this.selectedHandIndex; }
  getValidMovePositions() { return this.validMovePositions; }
  getValidAttackPositions() { return this.validAttackPositions; }
  getValidSummonPositions() { return this.validSummonPositions; }

  getHighlightedPositions() {
    if (this.state === STATES.UNIT_SELECTED) {
      return [...this.validMovePositions, ...this.validAttackPositions];
    }
    if (this.state === STATES.CARD_SELECTED) {
      return this.validSummonPositions;
    }
    return [];
  }

  getHighlightType() {
    if (this.state === STATES.UNIT_SELECTED) return 'move';
    if (this.state === STATES.CARD_SELECTED) return 'summon';
    return null;
  }

  // --- Private methods ---

  _moveCursor(dx, dy) {
    this.cursor.x = Math.max(0, Math.min(BOARD_COLS - 1, this.cursor.x + dx));
    this.cursor.y = Math.max(0, Math.min(BOARD_ROWS - 1, this.cursor.y + dy));
    this.ui.render();
  }

  _confirm() {
    const gs = this.sessionManager.gameSession;
    if (!gs) return;

    const pos = { ...this.cursor };

    if (this.state === STATES.IDLE) {
      if (!gs.isMyTurn()) {
        this.ui.setStatus("It's not your turn.");
        return;
      }
      const board = gs.getBoard();
      const unit = safeGet(() => board.getUnitAtPosition(pos), null);
      if (unit && unit.getOwnerId() === this.sessionManager.myPlayerId) {
        this._selectUnit(unit, pos, gs);
      }

    } else if (this.state === STATES.UNIT_SELECTED) {
      const board = gs.getBoard();
      const unitAtCursor = safeGet(() => board.getUnitAtPosition(pos), null);

      const isMovePos = this.validMovePositions.some((p) => p.x === pos.x && p.y === pos.y);
      const isAttackPos = this.validAttackPositions.some((p) => p.x === pos.x && p.y === pos.y);

      if (isAttackPos && unitAtCursor) {
        this._executeAttack(pos, gs);
      } else if (isMovePos && !unitAtCursor) {
        this._executeMove(pos, gs);
      } else if (unitAtCursor && unitAtCursor.getOwnerId() === this.sessionManager.myPlayerId) {
        // Re-select a different own unit
        this._cancel();
        this._selectUnit(unitAtCursor, pos, gs);
      } else {
        this._cancel();
      }

    } else if (this.state === STATES.CARD_SELECTED) {
      const isSummonPos = this.validSummonPositions.some((p) => p.x === pos.x && p.y === pos.y);
      if (isSummonPos) {
        this._playCard(pos, gs);
      } else {
        this._cancel();
      }
    }
  }

  _selectUnit(unit, pos, gs) {
    this.selectedUnitPos = { ...pos };
    this.state = STATES.UNIT_SELECTED;

    const board = gs.getBoard();

    // Compute valid move positions using the unit's movement pattern
    this.validMovePositions = [];
    if (safeGet(() => unit.getCanMove(), false)) {
      try {
        const pattern = unit.getMovementPattern(); // relative offsets
        this.validMovePositions = pattern
          .map((offset) => ({ x: pos.x + offset.x, y: pos.y + offset.y }))
          .filter((p) => board.isOnBoard(p) && !board.getObstructionAtPositionForEntity(p, unit));
      } catch (e) {
        // Fallback: simple Manhattan distance if pattern API fails
        const speed = safeGet(() => unit.getSpeed(), 2);
        for (let dx = -speed; dx <= speed; dx++) {
          for (let dy = -(speed - Math.abs(dx)); dy <= speed - Math.abs(dx); dy++) {
            if (dx === 0 && dy === 0) continue;
            const p = { x: pos.x + dx, y: pos.y + dy };
            if (board.isOnBoard(p) && !safeGet(() => board.getObstructionAtPositionForEntity(p, unit), true)) {
              this.validMovePositions.push(p);
            }
          }
        }
      }
    }

    // Compute valid attack positions
    this.validAttackPositions = [];
    if (safeGet(() => unit.getCanAttack(), false)) {
      try {
        const attackRange = unit.getAttackRange();
        const allUnits = board.getUnits();
        this.validAttackPositions = allUnits
          .filter((target) => {
            if (target.getOwnerId() === this.sessionManager.myPlayerId) return false;
            return attackRange.getIsValidTarget(board, unit, target);
          })
          .map((target) => target.getPosition());
      } catch (e) {
        // Fallback: adjacent enemies
        const unitPos = unit.getPosition ? unit.getPosition() : pos;
        const allUnits = board.getUnits();
        this.validAttackPositions = allUnits
          .filter((target) => {
            if (target.getOwnerId() === this.sessionManager.myPlayerId) return false;
            const tp = target.getPosition();
            return Math.abs(tp.x - unitPos.x) + Math.abs(tp.y - unitPos.y) <= 1;
          })
          .map((target) => target.getPosition());
      }
    }

    const canAct = this.validMovePositions.length > 0 || this.validAttackPositions.length > 0;
    const name = safeGet(() => unit.getName(), 'unit');
    const atk = safeGet(() => unit.getATK(), '?');
    const hp = safeGet(() => unit.getHP(), '?');
    this.ui.setStatus(
      canAct
        ? `${name} (${atk}/${hp}) — arrows=move cursor, enter=confirm, esc=cancel`
        : `${name} (${atk}/${hp}) — exhausted (no actions). ESC to deselect.`,
    );
    this.ui.render();
  }

  _selectHandCard(index) {
    const gs = this.sessionManager.gameSession;
    if (!gs || !gs.isMyTurn()) {
      this.ui.setStatus("It's not your turn.");
      return;
    }

    const myPlayer = gs.getMyPlayer();
    let card;
    try {
      card = myPlayer.getDeck().getCardsInHandExcludingMissing()[index];
    } catch (e) {
      card = null;
    }
    if (!card) return;

    const cost = safeGet(() => card.getManaCost(), 999);
    const mana = safeGet(() => myPlayer.getRemainingMana(), 0);
    if (mana < cost) {
      const name = safeGet(() => card.getName(), 'card');
      this.ui.setStatus(`Not enough mana for ${name} (need ${cost}, have ${mana})`);
      return;
    }

    this._cancel(); // Clear any existing selection
    this.selectedHandIndex = index;
    this.state = STATES.CARD_SELECTED;

    // Get valid placement positions for this card
    try {
      this.validSummonPositions = card.getValidTargetPositions() || [];
    } catch (e) {
      this.validSummonPositions = [];
    }

    const name = safeGet(() => card.getName(), 'card');
    this.ui.setStatus(`Playing: ${name} (${cost} mana) — move cursor to target, enter=place, esc=cancel`);
    this.ui.render();
  }

  _executeMove(targetPos, gs) {
    const board = gs.getBoard();
    const unit = safeGet(() => board.getUnitAtPosition(this.selectedUnitPos), null);
    if (!unit) { this._cancel(); return; }

    const action = unit.actionMove(targetPos);
    if (this.sessionManager.submitAction(action, this.gameSocket)) {
      const name = safeGet(() => unit.getName(), 'unit');
      this.ui.setStatus(`Moving ${name} to (${targetPos.x},${targetPos.y})…`);
      // Update selected position and recompute actions (unit can attack after moving)
      this.selectedUnitPos = { ...targetPos };
      this.validMovePositions = []; // Can't move again this turn
      // Leave state as UNIT_SELECTED so they can still attack
    } else {
      this.ui.setStatus('Move action invalid.');
    }
    this.ui.render();
  }

  _executeAttack(targetPos, gs) {
    const board = gs.getBoard();
    const unit = safeGet(() => board.getUnitAtPosition(this.selectedUnitPos), null);
    const targetUnit = safeGet(() => board.getUnitAtPosition(targetPos), null);
    if (!unit || !targetUnit) { this._cancel(); return; }

    const action = unit.actionAttack(targetUnit);
    if (this.sessionManager.submitAction(action, this.gameSocket)) {
      const attName = safeGet(() => unit.getName(), 'unit');
      const defName = safeGet(() => targetUnit.getName(), 'target');
      this.ui.setStatus(`${attName} attacks ${defName}…`);
      this._cancel();
    } else {
      this.ui.setStatus('Attack action invalid.');
    }
    this.ui.render();
  }

  _playCard(targetPos, gs) {
    const myPlayer = gs.getMyPlayer();
    const cards = safeGet(() => myPlayer.getDeck().getCardsInHandExcludingMissing(), []);
    const card = cards[this.selectedHandIndex];
    if (!card) { this._cancel(); return; }

    const action = myPlayer.actionPlayCardFromHand(this.selectedHandIndex, targetPos.x, targetPos.y);
    if (this.sessionManager.submitAction(action, this.gameSocket)) {
      const name = safeGet(() => card.getName(), 'card');
      this.ui.setStatus(`Playing ${name} at (${targetPos.x},${targetPos.y})…`);
      this._cancel();
    } else {
      this.ui.setStatus('Card play invalid.');
    }
    this.ui.render();
  }

  _endTurn() {
    const gs = this.sessionManager.gameSession;
    if (!gs) return;
    if (!gs.isMyTurn()) {
      this.ui.setStatus("It's not your turn.");
      return;
    }
    const action = gs.actionEndTurn();
    if (this.sessionManager.submitAction(action, this.gameSocket)) {
      this.ui.setStatus('Ending turn…');
      this._cancel();
    } else {
      this.ui.setStatus('Cannot end turn right now.');
    }
  }

  _cancel() {
    this.state = STATES.IDLE;
    this.selectedUnitPos = null;
    this.selectedHandIndex = null;
    this.validMovePositions = [];
    this.validAttackPositions = [];
    this.validSummonPositions = [];
    this.ui.render();
  }
}

function safeGet(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

module.exports = InputController;
