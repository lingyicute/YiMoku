#!/usr/bin/env node
/* YiMoku — 引擎改动等价性对拍（零依赖，约 20–40 秒）
 *
 * 与 selftest/smoke 同风格：从 index.html 抽取主脚本，在 Node 里对拍特性开关：
 *
 *  1. AI_FAST_LEAF（滑动窗口 + stamp 复用）：开/关两版在随机局面上
 *     fiveThreatCount / evalBoard / candidateList / evalLeaf 必须逐位一致。
 *  2. AI_TT（置换表）：
 *     a. 同配置两次运行的根值必须逐位一致（确定性；跨配置 TT≡无TT 不是
 *        合法不变式，见 3a 处注释——旧版断言是 flaky 的，见评估报告）；
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
  pointTierEx, candidateList, scoreCell, abSearch, searchBest
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
const NO_TT = loadEngine(['AI_TT']);                           // 关置换表
const NO_INC = loadEngine(['AI_INC_EVAL']);                    // 关增量方向评估

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

/* ---- 2a. AI_TT：确定性（同配置两次运行逐位一致） ----
 * 旧版在此断言「TT≡无TT（±4）」，但这不是合法不变式，所以是 flaky 的：
 * 默认 FUZZ_BOARDS=250 恰好通过，60/100/150/200/300/400 下均失败。
 * 根因不在 TT——TT 缓存本身是保值的（冻结 HIST 后 TT≡无TT 逐位一致已验证）；
 * 而在于 HIST 会改变 top-K 候选集：TT 有无 → 截断模式不同 → HIST 不同 →
 * 宽度边界处的候选集不同 → 两棵合法但不同的剪枝树。此外叶子深层 EXACT
 * 复用也会合法地加深其中一棵树。TT 真正的回归性质是：确定性（本节）+
 * 热表幂等（3c）+ 杀分 ply 重定基（3b）。 */
let ttChecks = 0;
for (let t = 0; t < 16; t++) {
  const b = sparseBoard();
  for (const ai of [FULL.BLACK, FULL.WHITE]) {
    for (const D of [2, 3, 4]) {
      const A1 = loadEngine([]);              // TT 实例一（全新冷表）
      const A2 = loadEngine([]);              // TT 实例二（全新冷表）
      const N1 = loadEngine(['AI_TT']);       // 无 TT 实例一
      const N2 = loadEngine(['AI_TT']);       // 无 TT 实例二
      const t0 = A1.now();
      const a1 = A1.abSearch(b, ai, ai, D, -A1.WIN_V, A1.WIN_V, 0, t0, 60000, A1.EXT_LIMIT);
      const a2 = A2.abSearch(b, ai, ai, D, -A2.WIN_V, A2.WIN_V, 0, t0, 60000, A2.EXT_LIMIT);
      const n1 = N1.abSearch(b, ai, ai, D, -N1.WIN_V, N1.WIN_V, 0, N1.now(), 60000, N1.EXT_LIMIT);
      const n2 = N2.abSearch(b, ai, ai, D, -N2.WIN_V, N2.WIN_V, 0, N2.now(), 60000, N2.EXT_LIMIT);
      if (a1 === null || n1 === null) continue;
      ck(a1 === a2, 'TT 运行确定性 ai=' + ai + ' D=' + D + ': ' + a1 + '/' + a2);
      ck(n1 === n2, '无TT 运行确定性 ai=' + ai + ' D=' + D + ': ' + n1 + '/' + n2);
      ck(Number.isFinite(a1) && Math.abs(a1) <= FULL.WIN_V, 'TT 值域合法 ai=' + ai + ' D=' + D + ': ' + a1);
      ttChecks += 3;
    }
  }
}

/* ---- 2b. AI_TT：杀棋分值 ply 重定基 ---- */
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

/* ---- 2c. AI_TT：热表幂等 + 值域 + AI_INC_EVAL 逐位等价 ---- */
for (let t = 0; t < 10; t++) {
  const b = randomBoard(1);
  const ai = t % 2 === 0 ? FULL.BLACK : FULL.WHITE;
  const D = 2 + (t % 3);
  const h1 = FULL.abSearch(b, ai, ai, D, -FULL.WIN_V, FULL.WIN_V, 0, FULL.now(), 30000, FULL.EXT_LIMIT);
  const h2 = FULL.abSearch(b, ai, ai, D, -FULL.WIN_V, FULL.WIN_V, 0, FULL.now(), 30000, FULL.EXT_LIMIT);
  if (h1 === null) continue;
  ck(h1 === h2 && Number.isFinite(h1) && Math.abs(h1) <= FULL.WIN_V, 'TT 热表幂等/值域: ' + h1 + '/' + h2);
  const gcl = FULL.candidateList(b);
  const gsc1 = [], gsc2 = [];
  for (const gi of gcl) {
    const c = FULL.scoreCell(b, gi % 15, (gi / 15) | 0, ai);
    gsc1.push(c); gsc2.push(Object.assign({}, c));
  }
  gsc1.sort((a, c) => c.s - a.s); gsc2.sort((a, c) => c.s - a.s);
  const mInc = loadEngine([]); const mNoInc = loadEngine(['AI_INC_EVAL']);
  const rInc = mInc.searchBest(b.slice(), ai, gsc1.slice(0, 12), D, 30000);
  const rNoInc = mNoInc.searchBest(b.slice(), ai, gsc2.slice(0, 12), D, 30000);
  ck(rInc && rNoInc && rInc.i === rNoInc.i, 'AI_INC_EVAL searchBest 等价 D=' + D + ': ' + (rInc && rInc.i) + ' vs ' + (rNoInc && rNoInc.i));
  ttChecks++;
}

console.log('对拍局面数=' + BOARDS);
console.log('TT 严格一致性检查=' + ttChecks + ' 项');
if (fails) { console.error('tests/fuzz.js: FAIL（' + fails + ' 项不一致）'); process.exit(1); }
console.log('tests/fuzz.js: PASS');
