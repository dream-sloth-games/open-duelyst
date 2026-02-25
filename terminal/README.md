# Open-Duelyst Terminal TUI

A keyboard-driven terminal client for Open-Duelyst using the same game SDK as the browser client.

## Quick Start

```bash
# With a running game server (default: http://localhost:3000):
node terminal/index.js

# Or via yarn/npm script:
yarn terminal
```

## Prerequisites

1. The API server must be running (`yarn api`)
2. The single-player server must be running for SP games (`yarn sp`)
3. You need a registered user account

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DUELYST_API` | `http://localhost:3000` | API server URL |
| `NODE_ENV` | `development` | `production`/`staging` use wss:// |

## Game Flow

1. **Login** — enter username and password
2. **Mode** — choose single-player (vs AI) or multiplayer (PvP matchmaking)
3. **Deck** — select from your saved decks
4. **Play** — the TUI board appears with your game

## Controls

| Key | Action |
|-----|--------|
| Arrow keys / `h j k l` | Move cursor |
| `Enter` / `Space` | Select unit or confirm target |
| `1`–`7` | Select card from hand by number |
| `e` | End turn |
| `Escape` | Cancel / deselect |
| `q` / `Ctrl-C` | Quit |

## Board Layout

```
┌─────────────────── STATUS (Mana / HP / Turn) ───────────────────┐
│                                                                   │
│        9×5 board — Unicode box-drawing grid                      │
│   Each cell shows: owner (ME/OP), [G]eneral, ATK/HP             │
│   Cursor: >   Selected: SLCT   Move target: [MOV]               │
│   Attack target: [ATK]   Summon position: [SUM]                  │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│ Hand panel (left)            │ Game log (right)                  │
│  [1] CardName   3M +         │ > Player moved unit              │
│  [2] Spell      2M -         │ > AI summoned unit               │
└───────────────────────────────────────────────────────────────────┘
```

## Architecture

```
terminal/
├── index.js              Entry point (loads shims, starts app)
├── shims/
│   ├── globals.js        TelemetryManager + Backbone + Storage shims
│   └── storage-node.js   Node.js Map-backed store (replaces browser localStorage)
├── api/
│   ├── auth.js           POST /session/ login
│   ├── games.js          GET /api/me/decks, POST /api/me/games/single_player
│   └── matchmaking.js    PvP matchmaking endpoints
├── network/
│   └── gameSocket.js     Custom socket.io client (bypasses NetworkManager)
├── game/
│   └── sessionManager.js Non-authoritative GameSession lifecycle
└── ui/
    ├── app.js            blessed layout + pre-game flow
    ├── boardRenderer.js  9×5 ASCII board (Unicode box-drawing)
    ├── handRenderer.js   Player hand display
    ├── inputController.js Keyboard input state machine
    └── logPane.js        Game event log
```

## Technical Notes

- Uses the same `app/sdk/` game engine as the browser client (no modifications)
- Runs in **non-authoritative mode**: actions are sent to the server, which re-executes them and
  broadcasts the signed step back; the local session calls `executeAuthoritativeStep()` on receipt
- Bypasses `NetworkManager` entirely to avoid browser-specific globals; uses `socket.io-client` directly
- Global shims for `TelemetryManager`, `Backbone.Collection`, and `Storage` are installed before
  any SDK code loads
