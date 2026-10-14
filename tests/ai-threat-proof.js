#!/usr/bin/env node
/* AI-only: an independently proved VCT miss, signed-stamp rollover, and
 * equivalence of the reduced defence proof. No dependencies or timing gates.
 * ENGINE_HTML=/path/to/baseline.html node tests/ai-threat-proof.js
 * THREAT_BENCH=1 node tests/ai-threat-proof.js   # optional local microbenchmark
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const html = fs.readFileSync(process.env.ENGINE_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const main = html.match(/<script id="main">([\s\S]*?)<\/script>/)[1];
const src = main.slice(0, main.indexOf('/* ---------- 入口 ---------- */'));
function engine(slow = false) {
  const code = slow ? src.replace('AI_FAST_LEAF = true', 'AI_FAST_LEAF = false') : src;
  return new Function('performance', code + `
    return { vcfRoot, vctRoot, evalLeaf, fiveThreatCount, openThreeCount,
      proof: opponentThreesForced,
      // Original all-legal-reply algorithm: reference for this pure optimization.
      reference(b, side) {
        if (!AI_OPENTHREE_STRICT) return false;
        const opp = other(side), lines = [];
        for (let li = 0; li < LINES.length; li++) {
          if (openThreeOnLine(b, LINES[li], opp) > 0) lines.push(LINES[li]);
        }
        if (!lines.length) return false;
        for (let i = 0; i < N*N; i++) {
          if (b[i]) continue;
          if (pointTier(b, i % N, (i / N) | 0, side) >= T.FOUR) return false;
          b[i] = side;
          let survives = false;
          for (let j = 0; j < lines.length; j++) {
            if (openThreeOnLine(b, lines[j], opp) > 0) { survives = true; break; }
          }
          b[i] = EMPTY;
          if (!survives) return false;
        }
        return true;
      },
      stamps(n) { thrStamp = markStamp = vctStamp = n; },
      captured(b, side) { const out = []; return { n: fiveThreatCount(b, side, 2, out), i: out[0] }; },
      vctCount(b, side) { return vctFives(b, side, VCT_FIVE, 2); },
      forced(b, ai, side) { return evalForcedLine(b, ai, side, 0, LEAF_Q_MAX); },
      fastLeaf(b, ai, side) {
        initIncTable(b); incActive = true;
        try { return evalLeaf(b, ai, side, 0); }
        finally { incActive = false; incDirty = lineDirty = -1; }
      }
    };`)({ now: () => 0 });
}
const at = (x, y) => y * 15 + x;
// Independent five-cell-window oracle; does not use any engine threat code.
const windows = [];
for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
  for (const [dx, dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
    if (x + 4*dx < 0 || x + 4*dx >= 15 || y + 4*dy < 0 || y + 4*dy >= 15) continue;
    windows.push(Array.from({ length: 5 }, (_, k) => at(x + k*dx, y + k*dy)));
  }
}
function five(b, p) { return windows.some(line => line.every(i => b[i] === p)); }
function wins(b, p) {
  const out = new Set();
  for (const line of windows) {
    let n = 0, empty = -1;
    for (const i of line) { if (b[i] === p) n++; else if (!b[i]) empty = i; }
    if (n === 4 && empty >= 0) out.add(empty);
  }
  return [...out].sort((a, b) => a - b);
}
function board(stones) {
  const b = new Uint8Array(225);
  for (const [x, y, p] of stones) { assert.equal(b[at(x,y)], 0); b[at(x,y)] = p; }
  return b;
}
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
const e = engine();
// Legal sequence: D10 E10 H4 K9 E11 G12 E12 L10 G5 G10 E5; white to move.
// J10 creates ONE jump-three. H11/F13/L8 can block it, but each permits H10
// with two distinct winning points F10/K10. Every other reply permits H11
// making an open four instead. This is a full 213-reply proof, not a beam.
const sequence = [138,139,52,129,154,171,169,145,66,141,64];
for (let flip = 0; flip < 2; flip++) for (let rot = 0; rot < 4; rot++) {
  const transform = i => {
    let x = i % 15, y = (i / 15) | 0;
    if (flip) x = 14 - x;
    for (let n = 0; n < rot; n++) [x, y] = [14 - y, x];
    return at(x, y);
  };
  for (const swap of [false, true]) test('single-three VCT full proof flip=' + flip + ' rot=' + rot + ' swap=' + swap, () => {
    const b = new Uint8Array(225), attacker = swap ? 1 : 2, defender = 3 - attacker;
    sequence.forEach((i, j) => {
      const p = 1 + j % 2;
      b[transform(i)] = swap ? 3 - p : p;
      assert(!five(b, 1) && !five(b, 2));
    });
    const before = b.slice(), move = transform(143);
    assert.equal(wins(b, 1).length, 0); assert.equal(wins(b, 2).length, 0);
    b[move] = attacker;
    assert.equal(e.openThreeCount(b, attacker, 100), 1);
    let replies = 0;
    for (let d = 0; d < 225; d++) if (!b[d]) {
      replies++;
      b[d] = defender;
      assert(!five(b, defender));
      const a = [157,185,115].map(transform).includes(d) ? transform(142) : transform(157);
      assert.equal(b[a], 0);
      b[a] = attacker;
      assert.equal(wins(b, defender).length, 0, 'defender cannot win first');
      assert(wins(b, attacker).length >= 2, 'one defensive stone cannot occupy two distinct winning points');
      b[a] = 0; b[d] = 0;
    }
    assert.equal(replies, 213);
    b[move] = 0;
    assert.deepEqual(b, before);
    assert.equal(e.vcfRoot(b, attacker, 3, 0, 1e9), null);
    assert.equal(e.vctRoot(b, attacker, 2, 0, 1e9), null);
    const result = e.vctRoot(b, attacker, 3, 0, 1e9);
    assert(result, 'must not prune the single-three/compound-threat win');
    assert.equal(result.i, move); assert.equal(result.len, 3);
    assert.deepEqual(b, before);
  });
}
// One shared winning point, not two: H8 completes both of black's closed fours.
const cross = board([[3,7,1],[4,7,1],[5,7,1],[6,7,1],
  [7,3,1],[7,4,1],[7,5,1],[7,6,1], [2,7,2],[7,2,2],
  [0,0,2],[3,0,2],[6,0,2],[9,0,2],[12,0,2]]);
assert.deepEqual(wins(cross, 1), [112]);
assert.equal(wins(cross, 2).length, 0);
for (const slow of [false, true]) for (const start of [0x7ffffffe, 0x7fffffff, 0x80000000]) {
  for (const name of ['count', 'capture', 'leaf', 'forced', 'vct']) test('signed stamp rollover ' + name + ' slow=' + slow + ' start=' + start, () => {
    const a = engine(slow), b = cross.slice(), before = b.slice();
    const expected = a.evalLeaf(b, 2, 2, 0);
    for (let n = 0; n < 3; n++) {
      if (n === 0) a.stamps(start);
      if (name === 'count') assert.equal(a.fiveThreatCount(b, 1), 1);
      if (name === 'capture') assert.deepEqual(a.captured(b, 1), { n: 1, i: 112 });
      if (name === 'leaf') assert.equal(a.evalLeaf(b, 2, 2, 0), expected);
      if (name === 'forced') assert.equal(a.forced(b, 2, 2), expected);
      if (name === 'vct') assert.equal(a.vctCount(b, 1), 1);
    }
    assert.deepEqual(b, before);
  });
}
// Targeted equivalence: true double-three, shared defence, and remote counter-four.
const targets = [
  board([[5,7,2],[6,7,2],[7,7,2],[7,5,2],[7,6,2]]),
  board([[3,7,2],[4,7,2],[5,7,2],[6,4,2],[6,5,2],[6,6,2],[1,7,1],[6,2,1]]),
  board([[5,7,2],[6,7,2],[7,7,2],[7,5,2],[7,6,2],[0,0,1],[2,0,1],[4,0,1]])
];
const corpus = [];
function equivalent(b, side) {
  // The production function is only called if BOTH sides have zero immediate wins.
  assert.equal(wins(b, 1).length, 0); assert.equal(wins(b, 2).length, 0);
  const before = b.slice();
  assert.equal(e.proof(b, side), e.reference(b, side));
  assert.deepEqual(b, before);
  assert.equal(e.fastLeaf(b, side, side), e.evalLeaf(b, side, side, 0));
  assert.deepEqual(b, before);
}
for (let n = 0; n < targets.length; n++) test('reduced defence proof fixture ' + n, () => {
  equivalent(targets[n], 1);
  assert.equal(e.proof(targets[n], 1), n === 0);
});
let seed = 0x3a715b9;
function rnd(n) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }
for (let n = 0; n < 300; n++) test('proof equivalence with random obstacles ' + n, () => {
  const b = targets[n % targets.length].slice();
  for (let j = 0; j < 3 + n % 24; j++) {
    const i = rnd(225), p = 1 + j % 2;
    if (b[i]) continue;
    b[i] = p;
    if (five(b, p) || wins(b, 1).length || wins(b, 2).length) b[i] = 0;
  }
  equivalent(b, 1); equivalent(b, 2);
  corpus.push(b);
});
if (process.env.THREAT_BENCH) {
  // Balanced targeted corpus; timing is descriptive, never a pass/fail gate.
  const cases = [...targets, ...corpus].filter(b => e.openThreeCount(b, 2) >= 2);
  let sink = 0;
  const run = (fn, rounds) => {
    const t = performance.now();
    for (let n = 0; n < rounds; n++) for (const b of cases) sink += fn(b, 1) ? 1 : 0;
    return performance.now() - t;
  };
  run(e.reference, 10); run(e.proof, 10);
  const old = [], current = [];
  for (let n = 0; n < 5; n++) {
    if (n % 2) { current.push(run(e.proof, 40)); old.push(run(e.reference, 40)); }
    else { old.push(run(e.reference, 40)); current.push(run(e.proof, 40)); }
  }
  const median = a => a.sort((x, y) => x - y)[2];
  console.log(JSON.stringify({ benchmark: 'double-three proof only', cases: cases.length,
    callsPerSample: cases.length * 40, oldMedianMs: median(old), newMedianMs: median(current), sink }));
}
console.log('AI threat proof: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
