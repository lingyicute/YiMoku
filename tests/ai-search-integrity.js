#!/usr/bin/env node
/* AI-only regressions: hash integrity, forcing move coverage, deepening exit.
 * No dependencies or wall-clock assertions. Reproduce on the original engine:
 * ENGINE_HTML=/path/to/original/index.html node tests/ai-search-integrity.js
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.ENGINE_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const main = html.match(/<script id="main">([\s\S]*?)<\/script>/)[1];
const src = main.slice(0, main.indexOf('/* ---------- 入口 ---------- */'));
function engine(options = {}) {
  let code = src;
  if (options.stableTree) {
    // Freeze history's influence on beam membership, and remove TT reuse of
    // deeper leaves. Otherwise these are legitimately different selective trees.
    code = code.replace('AI_TT = true', 'AI_TT = false').replace('HIST_CAP = 48', 'HIST_CAP = 0');
  }
  if (options.fullWindow) {
    const marker = 'if (q === 0) {\n      v = abSearch';
    assert(code.includes(marker), 'PVS reference injection must match');
    code = code.replace(marker, 'if (true) {\n      v = abSearch');
  }
  return new Function('performance', code + `
    return { ZL, ZH, WIN_V, boardHash, evalLeaf, chooseAiMove,
      search(b, ai, side, depth, fast) {
        if (fast) { initIncTable(b); incActive = true; }
        try { return abSearch(b, ai, side, depth, -WIN_V, WIN_V, 0, 0, 1e9, 0); }
        finally { incActive = false; incDirty = lineDirty = -1; }
      },
      rootIterations(b, ai, i, fakeWin = false) {
        const original = abSearch, depths = [];
        abSearch = function(...args) {
          if (args[6] === 1) depths.push(args[3]);
          return fakeWin ? WIN_V - 1 : original(...args);
        };
        try {
          const pick = searchBest(b, ai, [scoreCell(b, i % N, (i / N) | 0, ai)], 12, 1e9);
          return { depths, i: pick.i, active: incActive || zHashActive,
                   undo: uPtr, lineUndo: luPtr };
        } finally { abSearch = original; }
      }
    };`)({ now: () => 0 });
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
const at = (x, y) => y * 15 + x;
// Independent rules oracle; does not use the engine's tiers or threat scanners.
function five(b, i) {
  const p = b[i], x = i % 15, y = (i / 15) | 0;
  if (!p) return false;
  for (const [dx, dy] of [[1,0], [0,1], [1,1], [1,-1]]) {
    let n = 1;
    for (const sign of [-1, 1]) for (let k = 1; k < 15; k++) {
      const xx = x + sign * dx * k, yy = y + sign * dy * k;
      if (xx < 0 || xx >= 15 || yy < 0 || yy >= 15 || b[at(xx, yy)] !== p) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}
function wins(b, p) {
  const result = [];
  for (let i = 0; i < 225; i++) if (!b[i]) {
    b[i] = p;
    if (five(b, i)) result.push(i);
    b[i] = 0;
  }
  return result;
}
test('52-bit stone keys span 52 bits, not a 32-bit linear subspace', () => {
  const e = engine(), pivots = [];
  for (let i = 0; i < e.ZL.length; i++) {
    let v = (BigInt(e.ZH[i]) << 32n) | BigInt(e.ZL[i] >>> 0);
    while (v) {
      const bit = v.toString(2).length - 1;
      if (pivots[bit]) v ^= pivots[bit];
      else { pivots[bit] = v; break; }
    }
  }
  assert.equal(pivots.filter(Boolean).length, 52);
});
// Found with xorshift seed 1729 after 102581 zero-based random samples.
// Both boards have eight stones per colour, no five, black to move.
const collisionA = [121,9,162,3,159,170,31,206,6,142,165,147,60,70,137,107];
const collisionB = [66,134,96,168,104,59,24,56,214,159,180,100,204,179,88,54];
function fromMoves(moves) {
  const b = new Uint8Array(225);
  moves.forEach((i, j) => { assert.equal(b[i], 0); b[i] = 1 + j % 2; assert(!five(b, i)); });
  return b;
}
test('different legal positions must not share the known full-key collision', () => {
  const e = engine();
  assert.notEqual(e.boardHash(fromMoves(collisionA), 1, 1), e.boardHash(fromMoves(collisionB), 1, 1));
});
test('warm TT cannot substitute board A evaluation for board B', () => {
  const e = engine(), a = fromMoves(collisionA), b = fromMoves(collisionB);
  const av = e.evalLeaf(a, 1, 1, 0), bv = e.evalLeaf(b, 1, 1, 0);
  assert.equal(av, -12); assert.equal(bv, -23);
  for (const board of [a, b, a, b]) {
    assert.equal(e.search(board, 1, 1, 0, false), e.evalLeaf(board, 1, 1, 0));
  }
});
// H8 creates two broken fours, but is not in the radius-one neighbourhood.
// Adjacent J8/H9 only create a single four and can be blocked at H8.
const distantFork = [[9,7,1],[10,7,1],[11,7,1],[7,9,1],[7,10,1],[7,11,1],
  [12,7,2],[7,12,2],[0,0,2],[3,0,2],[6,0,2],[9,0,2]];
for (let flip = 0; flip < 2; flip++) for (let rot = 0; rot < 4; rot++) {
  const transform = (x, y) => {
    if (flip) x = 14 - x;
    for (let k = 0; k < rot; k++) [x, y] = [14 - y, x];
    return at(x, y);
  };
  for (const swap of [false, true]) for (const fast of [false, true]) {
    test('distance-two double-four: flip=' + flip + ' rot=' + rot + ' swap=' + swap + ' fast=' + fast, () => {
      const e = engine(), b = new Uint8Array(225), p = swap ? 2 : 1;
      distantFork.forEach(([x, y, side]) => { b[transform(x, y)] = swap ? 3 - side : side; });
      const before = b.slice(), move = transform(7, 7);
      assert.equal(wins(b, p).length, 0); assert.equal(wins(b, 3 - p).length, 0);
      b[move] = p;
      assert.equal(wins(b, p).length, 2);
      // Every legal defender move still loses immediately on the next turn.
      for (let i = 0; i < 225; i++) if (!b[i]) {
        b[i] = 3 - p;
        assert(!five(b, i)); assert(wins(b, p).length > 0);
        b[i] = 0;
      }
      b.set(before);
      assert.equal(e.search(b, p, p, 1, fast), e.WIN_V - 2);
      assert.deepEqual(b, before);
    });
  }
}
test('proven root win exits deepening, restoring all search state', () => {
  const e = engine(), b = new Uint8Array(225);
  distantFork.forEach(([x, y, p]) => { b[at(x, y)] = p; });
  const before = b.slice(), result = e.rootIterations(b, 1, at(7, 7));
  assert.deepEqual(result.depths, [0, 1], 'do not repeat a settled win through all 12 iterations');
  assert.equal(result.i, at(7, 7));
  assert.equal(result.active, false); assert.equal(result.undo, 0); assert.equal(result.lineUndo, 0);
  assert.deepEqual(b, before);
});
test('a selective-search mate score alone must not trigger early convergence', () => {
  const e = engine(), b = fromMoves([112, 128]), before = b.slice();
  const result = e.rootIterations(b, 1, at(6, 7), true);
  assert.deepEqual(result.depths, Array.from({ length: 12 }, (_, i) => i));
  assert.deepEqual(b, before);
});
let seed = 0x573ba12;
function rnd(n) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }
for (let sample = 0; sample < 24; sample++) test('PVS/full-window and incremental/full-scan equivalence ' + sample, () => {
  const b = new Uint8Array(225);
  for (let j = 0; j < 10 + sample % 15; j++) {
    let i;
    do { i = at(2 + rnd(11), 2 + rnd(11)); } while (b[i]);
    b[i] = 1 + j % 2;
    if (five(b, i)) b[i] = 0;
  }
  const before = b.slice(), side = 1 + sample % 2, depth = 2 + sample % 3;
  const a = engine({ stableTree: true });
  const c = engine({ stableTree: true, fullWindow: true });
  const fast = engine({ stableTree: true });
  const value = a.search(b, side, side, depth, false);
  assert.equal(c.search(b, side, side, depth, false), value);
  assert.equal(fast.search(b, side, side, depth, true), value);
  assert.deepEqual(b, before);
});
console.log('AI search integrity: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
