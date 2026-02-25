'use strict';

// Board dimensions from SDK CONFIG
const BOARD_COLS = 9; // x: 0-8 (left = P1, right = P2)
const BOARD_ROWS = 5; // y: 0-4 (top to bottom)

// Cell dimensions in characters (must be odd-width for centering)
const CELL_W = 9; // inner content width (between vertical bars)
const CELL_H = 3; // lines per row (between horizontal borders)

// Unicode box-drawing characters
const H = '\u2500'; // ─
const V = '\u2502'; // │
const TL = '\u250C'; const TR = '\u2510'; // ┌ ┐
const BL = '\u2514'; const BR = '\u2518'; // └ ┘
const TM = '\u252C'; const BM = '\u2534'; // ┬ ┴
const LM = '\u251C'; const RM = '\u2524'; // ├ ┤
const CM = '\u253C'; // ┼

/**
 * Render the 9x5 game board as a multi-line string.
 *
 * @param {Board} board - SDK Board instance
 * @param {string} myPlayerId - Our player ID for owner highlighting
 * @param {{x:number,y:number}|null} selectedPos - Currently selected unit position
 * @param {{x:number,y:number}[]} highlightedPos - Valid move/attack/summon positions
 * @param {string|null} highlightType - 'move' | 'attack' | 'summon'
 * @param {{x:number,y:number}|null} cursorPos - Current cursor position
 * @returns {string} Multi-line string representation of the board
 */
function renderBoard(board, myPlayerId, selectedPos, highlightedPos, highlightType, cursorPos) {
  const lines = [];

  const selectedKey = selectedPos ? `${selectedPos.x},${selectedPos.y}` : null;
  const highlightSet = new Set((highlightedPos || []).map((p) => `${p.x},${p.y}`));
  const cursorKey = cursorPos ? `${cursorPos.x},${cursorPos.y}` : null;

  // Column header: x coordinate labels
  let header = '   '; // indent for row labels
  for (let x = 0; x < BOARD_COLS; x++) {
    header += ` ${String(x).padStart(Math.floor(CELL_W / 2) + 1).padEnd(CELL_W)} `;
  }

  // Top border
  let topBorder = TL;
  for (let x = 0; x < BOARD_COLS; x++) {
    topBorder += H.repeat(CELL_W);
    topBorder += x < BOARD_COLS - 1 ? TM : TR;
  }
  lines.push(topBorder);

  for (let y = 0; y < BOARD_ROWS; y++) {
    // Build the three sub-rows for this board row
    const subRows = [[], [], []];

    for (let x = 0; x < BOARD_COLS; x++) {
      let unit = null;
      try {
        unit = board.getUnitAtPosition({ x, y });
      } catch (e) {
        // Board might not be ready yet
      }

      const posKey = `${x},${y}`;
      const isSelected = posKey === selectedKey;
      const isHighlighted = highlightSet.has(posKey);
      const isCursor = posKey === cursorKey;

      const cellLines = renderCell(
        unit, myPlayerId, x, y, isSelected, isHighlighted, highlightType, isCursor,
      );

      subRows[0].push(V + cellLines[0]);
      subRows[1].push(V + cellLines[1]);
      subRows[2].push(V + cellLines[2]);
    }

    for (let r = 0; r < CELL_H; r++) {
      lines.push(subRows[r].join('') + V);
    }

    // Row divider or bottom border
    if (y < BOARD_ROWS - 1) {
      let divider = LM;
      for (let x = 0; x < BOARD_COLS; x++) {
        divider += H.repeat(CELL_W);
        divider += x < BOARD_COLS - 1 ? CM : RM;
      }
      lines.push(divider);
    } else {
      let bottom = BL;
      for (let x = 0; x < BOARD_COLS; x++) {
        bottom += H.repeat(CELL_W);
        bottom += x < BOARD_COLS - 1 ? BM : BR;
      }
      lines.push(bottom);
    }
  }

  return lines.join('\n');
}

/**
 * Render a single board cell (CELL_H lines, each CELL_W characters wide).
 *
 * @returns {string[]} Array of CELL_H strings, each exactly CELL_W chars wide
 */
function renderCell(unit, myPlayerId, x, y, isSelected, isHighlighted, highlightType, isCursor) {
  // Cursor indicator overrides other state in row 2
  const cursorMark = isCursor ? '>' : ' ';

  if (!unit) {
    // Empty cell
    let row1 = ' '.repeat(CELL_W);
    if (isSelected) {
      row1 = center('[SEL]', CELL_W);
    } else if (isHighlighted) {
      if (highlightType === 'move') row1 = center('[MOV]', CELL_W);
      else if (highlightType === 'attack') row1 = center('[ATK]', CELL_W);
      else if (highlightType === 'summon') row1 = center('[SUM]', CELL_W);
      else row1 = center('[  ]', CELL_W);
    }

    const row0 = ' '.repeat(CELL_W);
    const row2 = isCursor
      ? `${cursorMark}(${x},${y})${' '.repeat(CELL_W - 5 - (x > 9 ? 1 : 0) - (y > 9 ? 1 : 0))}`.slice(0, CELL_W)
      : ' '.repeat(CELL_W);

    return [row0, row1, row2];
  }

  // Cell with a unit
  const isOwn = unit.getOwnerId() === myPlayerId;
  const isGeneral = unit.getIsGeneral();
  const isExhausted = unit.getIsExhausted();

  // Row 0: owner indicator + general marker
  // e.g. "ME [G] x  " or "OP       "
  const ownerTag = isOwn ? 'ME ' : 'OP ';
  const generalTag = isGeneral ? '[G]' : '   ';
  const exhaustTag = isExhausted ? 'x' : ' ';
  const row0 = (ownerTag + generalTag + exhaustTag + '  ').slice(0, CELL_W).padEnd(CELL_W);

  // Row 1: unit name (up to 4 chars) + ATK/HP
  // e.g. "Pyre 2/3 "
  let name;
  try {
    name = (unit.getName() || '????').slice(0, 4).padEnd(4);
  } catch (e) {
    name = '????';
  }
  const atk = safeGet(() => unit.getATK(), '?');
  const hp = safeGet(() => unit.getHP(), '?');
  const atkHp = `${atk}/${hp}`;
  const row1 = (name + ' ' + atkHp).slice(0, CELL_W).padEnd(CELL_W);

  // Row 2: cursor + target indicator
  let row2Suffix;
  if (isSelected) {
    row2Suffix = center('SLCT', CELL_W - 1);
  } else if (isHighlighted) {
    row2Suffix = center('TRGT', CELL_W - 1);
  } else {
    const coord = `(${x},${y})`;
    row2Suffix = coord.padEnd(CELL_W - 1).slice(0, CELL_W - 1);
  }
  const row2 = (cursorMark + row2Suffix).slice(0, CELL_W).padEnd(CELL_W);

  return [row0, row1, row2];
}

function center(str, width) {
  const pad = Math.max(0, width - str.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

function safeGet(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

module.exports = { renderBoard };
