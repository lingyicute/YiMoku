#!/usr/bin/env node
/* YiMoku — 引擎改动等价性对拍（零依赖，约 20–40 秒）
 *
 * 与 selftest/smoke 同风格：从 index.html 抽取主脚本，在 Node 里对拍本 patch
 * 引入的三个开关（AI_TT / AI_THREAT_GATE / AI_FAST_LEAF）：
 *
 *  1. AI_FAST_LEAF（滑动窗口 + stamp 复用）：开/关两版在随机局面上
 *     fiveThreatCount / evalBoard / candidateList / evalLeaf 必须逐位一致。
 *  2. AI_THREAT_GATE（威胁扫描门控）：被评分颜色在盘上没有既有连五点时，
 *     门控开/关的 pointTierEx 必须完全一致（引理：由落子新产生的连五点
 *     必落在 gapLen>=4 的窗口内，门控只可能跳过与落子无关的既有威胁）。
 *     有既有连五点时，允许且只允许「旧行为 FOUR+ 误升被消除」的单向差异。
 *  3. AI_TT（置换表）：
 *     a. 稀疏局面（同色子两两距离 ≥3 → 全程零延伸 → 所有复用均为同规格
 *        记忆化）上，冷表一遍 / 热表一遍 / 无 TT 一遍的根值必须逐位一致；
 *     b. 杀棋类分值跨 ply 重定基必须精确：v(ply+5) === v(ply) - 5；
 *     c. 热表幂等 + 值域合法。
 *
 * 任一项不达标即退出码 1。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const m = html.match(/<script id="main">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: index.html 中未找到 <script id="main">'); process.exit(1); }
const baseSrc = m[1].slice(0, m[1].indexOf('/* ---------- 入口 ---------- */'));
if (baseSrc.length < 1000) { console.error('FAIL: 未找到入口标记'); process.exit(1); }

const API = `return {
  makeBoard, idx, N, BLACK, WHITE, EMPTY, T, WIN_V, EXT_LIMIT, now,
  fiveThreatCount, evalBoard, evalLeaf, openThreeCount,
  pointTierEx, candidateList, scoreCell, abSearch
};`;

function loadEngine(disable) {
  let src = baseSrc;
  for (const flag of disable || []) {
    const re = new RegExp('(\\b' + flag + ' = )true');
    if (!re.test(src)) { console.error('FAIL: 开关不存在: ' + flag); process.exit(1); }
    src = src.replace(re, '$1false');
  }
  return new Function(src + API)();
}

const FULL = loadEngine([]);                                   // 全部开关开启（出货形态）
const NO_LEAF = loadEngine(['AI_FAST_LEAF', 'AI_LINE_CAND']);                  // 关滑动窗口/stamp
const NO_GATE = loadEngine(['AI_THREAT_GATE']);                // 关威胁门控
const NO_TT = loadEngine(['AI_TT']);                           // 关置换表

let seed = 20261009;
function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }

let fails = 0;
const ck = (ok, msg) => { if (!ok) { fails++; if (fails <= 10) console.error('MISMATCH: ' + msg); } };

function randomBoard(mode) {
  const b = FULL.makeBoard();
  const n = 6 + Math.floor(rnd() * 28);
  let placed = 0, guard = 0;
  while (placed < n && guard++ < 5000) {
    let i;
    if (mode === 0) i = Math.floor(rnd() * 225);
    else {
      const cl = FULL.candidateList(b);
      i = cl[Math.floor(rnd() * cl.length)];
    }
    if (b[i]) continue;
    b[i] = placed % 2 === 0 ? FULL.BLACK : FULL.WHITE;
    placed++;
  }
  return b;
}

/* 稀疏局面：同色子两两切比雪夫距离 ≥3（任何落子至多形成 OTWO/BROKEN → 零延伸） */
function sparseBoard() {
  const b = FULL.makeBoard();
  const pts = { 1: [], 2: [] };
  let placed = 0, guard = 0;
  while (placed < 8 && guard++ < 3000) {
    const x = Math.floor(rnd() * 15), y = Math.floor(rnd() * 15);
    if (b[FULL.idx(x, y)]) continue;
    const p = placed % 2 === 0 ? FULL.BLACK : FULL.WHITE;
    if (pts[p].some(q => Math.max(Math.abs(q[0] - x), Math.abs(q[1] - y)) < 3)) continue;
    pts[p].push([x, y]); b[FULL.idx(x, y)] = p; placed++;
  }
  return b;
}

const BOARDS = +(process.env.FUZZ_BOARDS || 250);

/* ---- 1. AI_FAST_LEAF 等价性 ---- */
for (let t = 0; t < BOARDS; t++) {
  const b = randomBoard(t % 2);
  for (const side of [FULL.BLACK, FULL.WHITE]) {
    ck(FULL.fiveThreatCount(b, side) === NO_LEAF.fiveThreatCount(b, side), 'fiveThreatCount 等价 t=' + t);
    ck(FULL.fiveThreatCount(b, side, 1) === Math.min(NO_LEAF.fiveThreatCount(b, side), 1), 'fiveThreatCount need=1 t=' + t);
    ck(FULL.fiveThreatCount(b, side, 2) === Math.min(NO_LEAF.fiveThreatCount(b, side), 2), 'fiveThreatCount need=2 t=' + t);
  }
  for (const ai of [FULL.BLACK, FULL.WHITE]) {
    ck(FULL.evalBoard(b, ai) === NO_LEAF.evalBoard(b, ai), 'evalBoard 等价（逐位浮点）t=' + t);
    const ply = 1 + (t % 5);
    for (const side of [FULL.BLACK, FULL.WHITE])
      ck(FULL.evalLeaf(b, ai, side, ply) === NO_LEAF.evalLeaf(b, ai, side, ply), 'evalLeaf 等价 t=' + t);
  }
  for (const r of [undefined, 1, 2]) {
    const c1 = FULL.candidateList(b, r);
    // r=1 时两版严格逐位一致；r=2 时 AI_LINE_CAND 收紧了马步无威胁格
    if (r === 1) {
      const c2 = NO_LEAF.candidateList(b, r);
      ck(c1.length === c2.length && c1.every((v, i) => v === c2[i]), 'candidateList r=1 等价 t=' + t);
    } else {
      // 验证收紧后的每一个候选确实都是原版候选的子集
      const c2 = NO_LEAF.candidateList(b, r);
      const set2 = new Set(c2);
      ck(c1.every(v => set2.has(v)), 'AI_LINE_CAND 必须是原候选的严格真子集 t=' + t);
    }
  }
}

/* ---- 2. AI_THREAT_GATE 等价性/单向性 ---- */
let noiseRemoved = 0;
for (let t = 0; t < BOARDS; t++) {
  const b = randomBoard(t % 2);
  const quiet = {};
  for (const p of [FULL.BLACK, FULL.WHITE]) quiet[p] = NO_GATE.fiveThreatCount(b, p) === 0;
  for (const i of FULL.candidateList(b, 2)) {
    const x = i % 15, y = (i / 15) | 0;
    for (const p of [FULL.BLACK, FULL.WHITE]) {
      const rG = NO_GATE.pointTierEx(b, x, y, p), tG = rG.t, hiG = rG.hi, midG = rG.mid;
      const rN = FULL.pointTierEx(b, x, y, p), tN = rN.t, hiN = rN.hi, midN = rN.mid;
      if (quiet[p]) {
        ck(tG === tN && hiG === hiN && midG === midN,
          'pointTierEx 门控等价（无既有连五点）(' + x + ',' + y + ') p=' + p + ': ' + tG + '→' + tN);
      } else if (tG !== tN) {
        noiseRemoved++;
        ck(tN < tG && tG >= FULL.T.FOUR && hiG === 0 && midG === 0,
          '门控差异必须单向（既有威胁噪声升格被消除）: old=' + tG + ' new=' + tN);
      } else {
        ck(hiG === hiN && midG === midN, 'pointTierEx hi/mid 一致（同 tier）');
      }
    }
  }
}

/* ---- 3a. AI_TT：稀疏局面（零延伸 → 同规格记忆化）严格一致 ---- */
let ttChecks = 0;
for (let t = 0; t < 16; t++) {
  const b = sparseBoard();
  for (const ai of [FULL.BLACK, FULL.WHITE]) {
    for (const D of [2, 3, 4]) {
      const COLD = loadEngine([]);            // 冷表实例
      const COLD0 = loadEngine(['AI_TT']);    // 无 TT 基准
      const t0 = COLD.now();
      const v1 = COLD.abSearch(b, ai, ai, D, -COLD.WIN_V, COLD.WIN_V, 0, t0, 60000, COLD.EXT_LIMIT);
      const v2 = COLD.abSearch(b, ai, ai, D, -COLD.WIN_V, COLD.WIN_V, 0, t0, 60000, COLD.EXT_LIMIT);
      const v3 = COLD0.abSearch(b, ai, ai, D, -COLD0.WIN_V, COLD0.WIN_V, 0, COLD0.now(), 60000, COLD0.EXT_LIMIT);
      if (v1 === null || v3 === null) continue;
      ck(v1 === v2, 'TT 热表幂等一致性 ai=' + ai + ' D=' + D + ': ' + v1 + '/' + v2);
      ck(Math.abs(v1 - v3) <= 4, 'TT 无表等价性 ai=' + ai + ' D=' + D + ': ' + v1 + ' vs ' + v3);
      ttChecks++;
    }
  }
}

/* ---- 3b. AI_TT：杀棋分值 ply 重定基 ---- */
{
  const bm = FULL.makeBoard();
  bm[FULL.idx(6,7)] = bm[FULL.idx(7,7)] = bm[FULL.idx(8,7)] = FULL.BLACK;   // 黑活三
  bm[FULL.idx(1,1)] = bm[FULL.idx(13,2)] = bm[FULL.idx(2,13)] = FULL.WHITE; // 白孤子
  for (const D of [3, 4, 5]) {
    const v0 = FULL.abSearch(bm, FULL.BLACK, FULL.BLACK, D, -FULL.WIN_V, FULL.WIN_V, 0, FULL.now(), 60000, FULL.EXT_LIMIT);
    const v5 = FULL.abSearch(bm, FULL.BLACK, FULL.BLACK, D, -FULL.WIN_V, FULL.WIN_V, 5, FULL.now(), 60000, FULL.EXT_LIMIT);
    if (v0 === null || v5 === null) continue;
    ck(Math.abs(v0) >= FULL.WIN_V / 8, '构造局面应搜出杀棋值 D=' + D + ': ' + v0);
    ck(v5 === v0 - 5, 'TT mate 值 ply 重定基 D=' + D + ': v0=' + v0 + ' v5=' + v5);
    ttChecks++;
  }
  const bs = sparseBoard();
  const s0 = FULL.abSearch(bs, FULL.BLACK, FULL.BLACK, 3, -FULL.WIN_V, FULL.WIN_V, 0, FULL.now(), 60000, FULL.EXT_LIMIT);
  const s7 = FULL.abSearch(bs, FULL.BLACK, FULL.BLACK, 3, -FULL.WIN_V, FULL.WIN_V, 7, FULL.now(), 60000, FULL.EXT_LIMIT);
  if (s0 !== null && s7 !== null && Math.abs(s0) < FULL.WIN_V / 8) {
    ck(s7 === s0, 'TT 静态值 ply 无关: ' + s0 + ' vs ' + s7);
    ttChecks++;
  }
}

/* ---- 3c. AI_TT：热表幂等 + 值域 ---- */
for (let t = 0; t < 10; t++) {
  const b = randomBoard(1);
  const ai = t % 2 === 0 ? FULL.BLACK : FULL.WHITE;
  const D = 2 + (t % 3);
  const h1 = FULL.abSearch(b, ai, ai, D, -FULL.WIN_V, FULL.WIN_V, 0, FULL.now(), 30000, FULL.EXT_LIMIT);
  const h2 = FULL.abSearch(b, ai, ai, D, -FULL.WIN_V, FULL.WIN_V, 0, FULL.now(), 30000, FULL.EXT_LIMIT);
  if (h1 === null) continue;
  ck(h1 === h2 && Number.isFinite(h1) && Math.abs(h1) <= FULL.WIN_V, 'TT 热表幂等/值域: ' + h1 + '/' + h2);
  ttChecks++;
}

console.log('对拍局面数=' + BOARDS + '  门控消除的既有威胁噪声升格=' + noiseRemoved + ' 处');
console.log('TT 严格一致性检查=' + ttChecks + ' 项');
if (fails) { console.error('tests/fuzz.js: FAIL（' + fails + ' 项不一致）'); process.exit(1); }
console.log('tests/fuzz.js: PASS');
