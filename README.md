# YiMoku

### Just another gomoku — but this one has a real brain.

A clean, lightweight, and privacy-first gomoku (five-in-a-row) with a built-in threat-aware AI, crafted with Material You and modern web engineering.

Made with ❤️ by [lingyicute](https://github.com/lingyicute).

[🇺🇸 English] • [🌐 Source Code](https://github.com/lingyicute/YiMoku) • [🐛 Report Bug](https://github.com/lingyicute/YiMoku/issues)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-orange.svg)](https://github.com/lingyicute/YiMoku/blob/main/LICENSE)
[![Single File 126 KB](https://img.shields.io/badge/Single%20File-126%20KB-blue)](https://github.com/lingyicute/YiMoku/blob/main/index.html)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen)](https://github.com/lingyicute/YiMoku)
[![No Ads No Tracking](https://img.shields.io/badge/Ads%20%26%20Trackers-Zero-brightgreen)](https://github.com/lingyicute/YiMoku)
[![GitHub Stars](https://img.shields.io/github/stars/lingyicute/YiMoku?style=flat&color=yellow)](https://github.com/lingyicute/YiMoku)

## 📖 Overview

Browser gomoku is usually one of two things: a board buried under banner ads, or a "smart opponent" that plays random legal moves and lets you win by accident.

**YiMoku** keeps the classic rules — 15×15 board, black first, five in a row wins — and adds a genuine engine. Four difficulty levels take you from a deliberately beatable opponent up to an **alpha–beta searcher with iterative deepening**, undo takes back a **full move pair** instead of half your game, every stone is recorded in a **coordinate-labelled move list**, and records are kept locally. The entire game — markup, styles, logic, font — is **one self-contained HTML file** with **zero dependencies** and **zero network requests**.

## ✨ Features

- **⚫ A Proper Game of Gomoku**
  - Standard **15×15** board, black opens, **five in a row** horizontally, vertically or diagonally wins (overlines count); a full board is a draw.
  - The winning run is **highlighted** and the latest move is **marked**, so you never lose track of the game.
  - **Undo** retracts your move *and* the AI's reply as one pair — and even works after the game ends, resuming the clock where it stopped.
  - Live **move counter** and **elapsed-time** clock above the board; timing starts with your first stone.
- **🤖 An AI That Actually Plays**
  - **Four difficulties**: **简单 Easy** (noisy, occasionally misses your threats), **中等 Medium** (greedy with a light jitter), **困难 Hard** (alpha–beta under a **550 ms** budget) and **专家 Expert** (deeper iterative deepening under a **900 ms** budget).
  - **Choose your side** — take black and open, or take white and let the AI start automatically.
  - The engine classifies stone shapes (open threes, jump fours, double threats…), detects every intersection that completes a five, and resolves **provable wins and losses at the search leaves** — so it is not fooled by the horizon effect.
  - A natural per-difficulty "thinking" pause keeps the opponent feeling human.
- **👥 Two Ways to Play**
  - **人机对战 vs. AI** with selectable difficulty and side, or **双人对战 local PvP** — pass-and-play on one screen, black vs. white.
- **📜 Move List & Records**
  - A running game record with **board coordinates** (`A–O` × `1–15`, letter `I` skipped, Go-style).
  - **Records per mode**: AI wins / losses / draws with win rate, PvP results by colour, and your **fastest win** (fewest moves, with time and difficulty); one click — with a confirm — wipes the slate clean.
- **🎨 Material You & Polished Design**
  - **Dynamic theming**: eight accent hues (紫罗兰, 晴空蓝, 薄荷青, 青草绿, 暖阳黄, 落日橙, 樱花粉, 珊瑚红), each generating a complete Material token set for both modes.
  - **Day / Night mode** with the initial choice taken from `prefers-color-scheme`, and `prefers-reduced-motion` respected.
  - A result bar summarises every finished game — winner, move count and time.
- **🔒 100% Privacy, Offline & Ad-Free**
  - **Zero network requests** — the game is fully self-contained and works with the network switched off.
  - Theme, mode, difficulty, side and records live in `localStorage` (`yimoku:*`); nothing is ever uploaded.
  - Licensed under **AGPL-3.0**.
- **⌨️ Playable Without a Mouse**
  - Arrow keys or `W A S D` move a cursor, `Space` / `Enter` places a stone, `Z` undoes, `R` restarts, `H` opens the help dialog.
  - Every intersection is a real `<button>` with a coordinate `aria-label`, and turn/game status changes are announced via `aria-live`.

## 🛠️ Why YiMoku? (Under the Hood)

### 1. Threat-Aware Shape Evaluation

Each empty intersection is scored by what a stone placed there would become: five, four, open three, jump/broken threes, and so on, in all four directions — for **both** players. On top of that, the engine finds every empty point where either side would complete five in one move; an intersection creating **two such threats at once** is scored as an immediate win. Defence is weighted at 90% of attack, with a small pull towards the centre of the board.

### 2. Alpha–Beta Search with Iterative Deepening

Hard and Expert don't guess — they search. Candidate moves are restricted to the neighbourhood of existing stones, ordered by the heuristic score, then searched with alpha–beta pruning, deepening one ply per pass under a fixed time budget (**550 ms** hard, **900 ms** expert). Leaf positions run a provable threat check (a five-completing point for the side to move, or two for the opponent) before falling back to static window-based evaluation — which is what eliminates the classic horizon effect.

### 3. Difficulty as a Spectrum, Not a Switch

Easy and Medium are *designed* to be beatable: Easy only blocks your winning five ~62% of the time and picks noisily among the top-scored candidates, while Medium plays greedy with ±7% jitter. The result is an opponent that ramps from casual to punishing without ever changing the rules.

### 4. Zero-Dependency, Zero-Network Architecture

`index.html` contains everything — including a base64-embedded subset of the "Nebulove" typeface — and makes **no external requests at all**. It runs from `file://`, from a static host, or offline on a phone; no framework, no bundler, no analytics, no backend. The script even carries a **built-in self-test** for win detection and shape evaluation.

## 🚀 Play It Now

There is nothing to install — the game _is_ one HTML file.

### Option 1 — Just open it

Download `index.html` (or clone the repository) and double-click the file. It works straight from disk, offline.

### Option 2 — Serve it locally

```
git clone https://github.com/lingyicute/YiMoku.git
cd YiMoku
python3 -m http.server 8000     # then open http://localhost:8000
```

### Option 3 — Publish it anywhere

Drop `index.html` on GitHub Pages, Cloudflare Pages, Netlify or any static host — a single file is the entire deployment.

### Requirements

- **Browser**: any modern browser (Chrome, Edge, Firefox, Safari, or their mobile counterparts).
- **Network**: not required. Zero requests are made to any server.
- **Storage**: `localStorage` only, for theme, settings and records.
- **Permissions**: none.

## 🔨 Building from Source

There is no bundler and no dependency to install: `index.html` _is_ the artifact. The one generated part — the embedded font subset — has its generator checked in.

1. **Clone the repository**:

```
git clone https://github.com/lingyicute/YiMoku.git
cd YiMoku
```

2. **Edit and reload** — the file is organised with banner comments (board generation, shape evaluation, search, rendering, theming, dialogs), so the engine parts and the UI parts stay easy to navigate.

3. **Ship it** — commit and push; with GitHub Pages enabled, the update is live immediately.

### Regenerating the embedded font subset

The page embeds a ~43.8 KB subset (362 glyphs) of the 1.25 MB "Nebulove" typeface instead of linking it from a CDN, which is what keeps the "zero network requests" promise. When you add or change **user-visible text**, regenerate the subset — otherwise the new characters are simply not in the font and fall back to a system font:

```
pip install fonttools brotli
python3 scripts/subset_font.py          # rewrites the @font-face block of index.html in place
```

- The script is **idempotent**: re-running it on an unchanged page produces no diff, and it reports any characters the typeface itself does not contain (which then fall back to the system emoji font).

## 🧪 Testing

The shipped artifact stays exactly as it is — one zero-dependency HTML file. Everything under `tests/` is **development-only** tooling that the browser never loads.

```
npm install          # dev dependencies (jsdom only)
npm test             # built-in self-test + DOM smoke test  (~10 s)
npm run test:fuzz    # equivalence fuzzing & TT consistency (~10 s)
npm run test:bench   # AI strength & latency benchmark      (~1–2 min)
```

- **`tests/selftest.js`** — *zero-dependency*. Extracts the embedded `<script id="main">` from `index.html` and runs the engine's built-in self-test: win detection in all four directions, shape classification, threat counting and terminal leaf evaluation, the `TW[0]` NaN regression, guaranteed win/block at every difficulty, and a full simulated game.
- **`tests/smoke.js`** — *needs `npm install`*. Boots the real page inside jsdom and drives it end to end: the first-run help dialog, stone placement, AI replies, undo pairs, mode / difficulty / side switching, theme & palette popovers, record clearing, keyboard play, win highlighting and all three result-bar texts. Without jsdom it prints a skip notice instead of failing, so a bare clone still passes `npm test`.
- **`tests/bench.js`** — *zero-dependency, slow on purpose*. Plays real AI-vs-AI matches and fails on regression: Expert must beat Easy ≥ 5/6 and Medium ≥ 3/4, and per-move latency must stay inside the engine budgets (550 ms hard / 900 ms expert) plus machine slack. Run it whenever the engine changes.

## 🤗 Contributing

Contributions are always welcome!

- **Bug Reports & Feature Requests**: submit an issue on the [GitHub Issue Tracker](https://github.com/lingyicute/YiMoku/issues).
- **Pull Requests**: keep the single-file, zero-dependency philosophy intact and match the existing code style.
- **Before a PR**: run `npm test` — and `npm run test:bench` if you touched the engine. Both live in `tests/`, are dev-only, and never affect the shipped file.
- **Translations**: the interface is currently Simplified Chinese — an i18n layer plus translated string tables would be very welcome.
- **Engine improvements**: opening books, deeper search, or Renju-style forbidden-move rules are all interesting directions.

## 📄 License

```
Copyright (C) 2026 lingyicute <li@92li.uk>

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
```
