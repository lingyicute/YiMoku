#!/usr/bin/env node
/* AI-only tactical regressions. No dependencies, wall-clock thresholds or random moves.
 * Optional baseline comparison: YIMOKU_HTML=/path/to/old/index.html node tests/ai-regression.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const html = fs.readFileSync(process.env.YIMOKU_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script id="main">([\s\S]*?)<\/script>/);
assert(match, 'main script must exist');
const entry = match[1].indexOf('/* ---------- 入口 ---------- */');
assert(entry > 0, 'entry marker must exist');
function engine(clock = () => 0) {
  return new Function('performance', match[1].slice(0, entry) + `
    return { makeBoard, idx, other, WIN_V, T, pointTier, makesFive,
      openThreeCount, fiveThreatCount, evalBoard, evalLeaf, vcfRoot,
      leaf(b, ai, side, ply, fast) {
        if (fast) { initIncTable(b); incActive = true; }
        try { return evalLeaf(b, ai, side, ply); }
        finally { incActive = false; }
      },
      step(b, side, budget) {
        vcfBudget = VCF_CAP; vcfT0 = 0; vcfDeadline = budget;
        return vcfStep(b, side, 6);
      },
      probeIterations(b, budget, visit) {
        const original = abSearch;
        abSearch = () => { visit(); return 0; };
        try {
          return searchBest(b, BLACK,
            [scoreCell(b, 6, 7, BLACK), scoreCell(b, 8, 7, BLACK)], 2, budget);
        } finally { abSearch = original; }
      }
    };`)({ now: clock });
}
const E = engine();
let checks = 0, failed = 0;
function test(name, fn) {
  checks++;
  try { fn(); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function board(stones, transform, swap) {
  const b = E.makeBoard();
  for (const [x, y, p] of stones) {
    const [xx, yy] = transform(x, y);
    b[E.idx(xx, yy)] = swap ? E.other(p) : p;
  }
  return b;
}
const symmetries = [];
for (let flip = 0; flip < 2; flip++) for (let rot = 0; rot < 4; rot++) {
  symmetries.push((x, y) => {
    if (flip) x = 14 - x;
    for (let k = 0; k < rot; k++) [x, y] = [14 - y, x];
    return [x, y];
  });
}
// Legal black-to-move position: two white threes share the single defence G8.
const shared = [[3,7,2],[4,7,2],[5,7,2],[6,4,2],[6,5,2],[6,6,2]].concat(
  [[0,0,1],[3,0,1],[6,0,1],[9,0,1],[12,0,1],[0,3,1]]);
// White to move: H5 counter-four breaks black's vertical three; black must
// answer J5, then white can block the remaining horizontal three.
const counter = [[7,7,1],[8,7,1],[9,7,1],[7,5,1],[7,6,1],[3,4,1],
  [4,4,2],[5,4,2],[6,4,2],[0,0,2],[14,0,2]];
const independent = [[3,7,2],[4,7,2],[5,7,2],[10,4,2],[10,5,2],[10,6,2],
  [0,0,1],[3,0,1],[6,0,1],[9,0,1],[12,0,1],[0,3,1]];
// Independent oracle: all legal defender moves, actual five threats rather than
// the engine's point-tier classification. A retained strict three then wins.
function shortProof(b, side) {
  for (let i = 0; i < b.length; i++) {
    if (b[i]) continue;
    b[i] = side;
    const escapes = E.makesFive(b, i % 15, (i / 15) | 0) ||
      E.fiveThreatCount(b, side, 1) > 0 || E.openThreeCount(b, E.other(side), 1) === 0;
    b[i] = 0;
    if (escapes) return false;
  }
  return true;
}
for (const [name, stones, defender, forced] of [
  ['shared defence', shared, 1, false],
  ['counter-four', counter, 2, false],
  ['independent double three', independent, 1, true]
]) {
  symmetries.forEach((transform, n) => {
    for (const swap of [false, true]) {
      test(name + ' symmetry=' + n + ' swap=' + swap, () => {
        const b = board(stones, transform, swap), before = b.slice();
        const side = swap ? E.other(defender) : defender;
        assert.equal(E.openThreeCount(b, side), 0);
        assert(E.openThreeCount(b, E.other(side)) >= 2);
        assert.equal(E.fiveThreatCount(b, 1), 0);
        assert.equal(E.fiveThreatCount(b, 2), 0);
        assert.equal(shortProof(b, side), forced);
        for (const ai of [1, 2]) for (const ply of [0, 5]) {
          const expected = forced ? (ai === side ? -1 : 1) * (E.WIN_V / 4 - ply - 1) : E.evalBoard(b, ai);
          for (const fast of [false, true]) {
            assert.equal(E.leaf(b, ai, side, ply, fast), expected, 'leaf fast=' + fast);
            assert.deepEqual(b, before, 'evaluation must restore the board');
          }
        }
      });
    }
  });
}
test('shared defence really removes both threes', () => {
  const b = board(shared, symmetries[0], false);
  b[E.idx(6,7)] = 1;
  assert.equal(E.openThreeCount(b, 2), 0);
});
test('counter-four really forces a reply and buys a defence', () => {
  const b = board(counter, symmetries[0], false);
  b[E.idx(7,4)] = 2;
  assert.equal(E.fiveThreatCount(b, 2), 1);
  b[E.idx(8,4)] = 1;
  assert.equal(E.fiveThreatCount(b, 1), 0);
  b[E.idx(6,7)] = 2;
  assert.equal(E.openThreeCount(b, 1), 0);
});
test('VCF root respects an expired deadline', () => {
  const e = engine(() => 100), b = e.makeBoard();
  for (const x of [5,6,7]) b[e.idx(x,7)] = 1;
  const before = b.slice();
  assert.equal(e.vcfRoot(b, 1, 6, 0, 0), null);
  assert.deepEqual(b, before);
});
test('VCF recursive entry respects an expired deadline', () => {
  const e = engine(() => 100), b = e.makeBoard();
  for (const x of [5,6,7]) b[e.idx(x,7)] = 1;
  const before = b.slice();
  assert.equal(e.step(b, 1, 0), 0);
  assert.deepEqual(b, before);
});
test('VCF still finds a real win with a budget', () => {
  const b = E.makeBoard();
  for (const x of [5,6,7]) b[E.idx(x,7)] = 1;
  const before = b.slice(), r = E.vcfRoot(b, 1, 6, 0, 100);
  assert(r && r.len === 2);
  assert.deepEqual(b, before);
});
test('immediate win keeps priority over time and opposing threats', () => {
  const e = engine(() => 100), b = e.makeBoard();
  for (let x = 0; x < 4; x++) { b[e.idx(x,7)] = 1; b[e.idx(x,0)] = 2; }
  const r = e.vcfRoot(b, 1, 6, 0, 0);
  assert(r && r.len === 1 && r.i === e.idx(4,7));
});
test('VCF interruption restores the board at different clock cutoffs', () => {
  for (const cutoff of [1,2,3,4,8,16,32]) {
    let ticks = 0;
    const e = engine(() => ++ticks), b = e.makeBoard();
    for (const [x,y,p] of counter) b[e.idx(x,y)] = p;
    const before = b.slice();
    e.vcfRoot(b, 1, 9, 0, cutoff);
    assert.deepEqual(b, before);
  }
});
for (const [costPerNode, expectedNodes] of [[20, 4], [45, 2]]) {
  test('deepening budget policy, node cost=' + costPerNode, () => {
    let elapsed = 0, nodes = 0;
    const e = engine(() => elapsed), b = e.makeBoard();
    b[e.idx(7,7)] = 1; b[e.idx(8,8)] = 2;
    const before = b.slice();
    e.probeIterations(b, 100, () => { nodes++; elapsed += costPerNode; });
    // First iteration costs 40 or 90. Both predictions exceed 100, but only
    // the latter has <20% left: 60% remaining must still start iteration two.
    assert.equal(nodes, expectedNodes);
    assert.deepEqual(b, before);
  });
}
console.log('AI regression: ' + (checks - failed) + '/' + checks + ' passed');
if (failed) process.exitCode = 1;
