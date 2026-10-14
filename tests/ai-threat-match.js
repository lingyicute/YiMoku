#!/usr/bin/env node
/* Optional, slow, paired A/B matches against the unmodified engine.
 * BASELINE_HTML=/path/to/old/index.html node tests/ai-threat-match.js
 * PAIRS=8 DIFFICULTY=expert MATCH_LOG=/path/to/results.json ...
 * Same opening, swapped engine colours; fresh state each game. Time-limited
 * searches remain machine-dependent. Small samples are NOT an Elo estimate.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
if (!process.env.BASELINE_HTML) throw Error('Set BASELINE_HTML to the unmodified index.html');
function source(file) {
  const main = fs.readFileSync(file, 'utf8').match(/<script id="main">([\s\S]*?)<\/script>/)[1];
  return main.slice(0, main.indexOf('/* ---------- 入口 ---------- */'));
}
const original = source(process.env.BASELINE_HTML);
const patched = source(path.join(__dirname, '..', 'index.html'));
const load = code => new Function(code + '\nreturn { chooseAiMove };')();
const openings = [
  [112,113], [112,128], [112,97], [112,126],
  [112,113,127,97], [112,128,111,97], [112,97,128,113], [112,126,98,113]
];
const pairs = +(process.env.PAIRS || 8), diff = process.env.DIFFICULTY || 'expert';
assert(Number.isInteger(pairs) && pairs > 0 && pairs <= openings.length);
assert(['hard','expert'].includes(diff));
function five(b, i) {
  const p = b[i], x = i % 15, y = (i / 15) | 0;
  for (const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let n = 1;
    for (const sign of [-1,1]) for (let k = 1; k < 15; k++) {
      const xx = x + sign*dx*k, yy = y + sign*dy*k;
      if (xx < 0 || xx >= 15 || yy < 0 || yy >= 15 || b[yy*15+xx] !== p) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}
const results = [], times = { original: [], patched: [] };
let won = 0, lost = 0, draws = 0, unfinished = 0;
for (let pair = 0; pair < pairs; pair++) for (const patchedColour of [1,2]) {
  const players = patchedColour === 1 ? [null,load(patched),load(original)] : [null,load(original),load(patched)];
  const b = new Uint8Array(225), moves = openings[pair].slice();
  moves.forEach((i,j) => { assert.equal(b[i],0); b[i] = 1+j%2; assert(!five(b,i)); });
  const game = { pair, patchedColour, opening: moves.slice(), winner: 0, status: 'move-limit', turns: [] };
  while (moves.length < 160) {
    const side = 1 + moves.length % 2, name = side === patchedColour ? 'patched' : 'original';
    const before = b.slice(), t = performance.now();
    const move = players[side].chooseAiMove(b, diff, side);
    const ms = performance.now() - t;
    assert.deepEqual(b, before, 'decision must restore the board');
    assert(move && Number.isInteger(move.i) && move.i >= 0 && move.i < 225);
    assert.equal(b[move.i], 0, 'legal move');
    assert.equal(move.i, move.y * 15 + move.x);
    times[name].push(ms);
    game.turns.push({ side, engine: name, i: move.i, ms, vcf: move.vcf || 0, vct: !!move.vct });
    b[move.i] = side; moves.push(move.i);
    if (five(b, move.i)) { game.winner = side; game.status = 'win'; break; }
    if (!b.includes(0)) { game.status = 'draw'; break; }
  }
  game.moves = moves;
  if (game.status === 'draw') draws++;
  else if (game.status !== 'win') unfinished++;
  else if (game.winner === patchedColour) won++;
  else lost++;
  results.push(game);
  console.log(JSON.stringify({ pair, patchedColour, winner: game.winner, status: game.status, plies: moves.length }));
}
const stats = a => {
  a.sort((x,y) => x-y);
  return { moves: a.length, meanMs: a.reduce((s,x) => s+x,0)/a.length,
    p95Ms: a[Math.floor((a.length-1)*0.95)], maxMs: a[a.length-1] };
};
const summary = { difficulty: diff, pairs, won, lost, draws, unfinished,
  original: stats(times.original), patched: stats(times.patched) };
console.log(JSON.stringify(summary));
if (process.env.MATCH_LOG) fs.writeFileSync(process.env.MATCH_LOG, JSON.stringify({ summary, results }, null, 2));
