#!/usr/bin/env node
/* YiMoku — AI 强度 & 耗时基准（零依赖，约 1–2 分钟）
 *
 * 作为引擎改动的回归门槛，任一项不达标即退出码 1：
 *   1) 专家 vs 简单  ×6 局，胜率 ≥ 5/6
 *   2) 专家 vs 中等  ×4 局，胜率 ≥ 3/4
 *   3) 安静中盘单步耗时：hard / expert 平均不超过「预算 + 400ms」
 *   4) 任意单步最大耗时 ≤ 1500ms（预算 900ms + 慢机器余量）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const m = html.match(/<script id="main">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: index.html 中未找到 <script id="main">'); process.exit(1); }
const src = m[1];
const entry = src.indexOf('/* ---------- 入口 ---------- */');
if (entry < 0) { console.error('FAIL: 未找到入口标记，bench 注入点失效'); process.exit(1); }

const bench = `
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

function benchPlay(p1, p2) {
  const b = makeBoard();
  let moves = 0, maxT = 0;
  while (moves < 225) {
    const p = moves % 2 === 0 ? BLACK : WHITE;
    const t0 = Date.now();
    const mv = chooseAiMove(b, p === BLACK ? p1 : p2, p);
    maxT = Math.max(maxT, Date.now() - t0);
    b[mv.i] = p; moves++;
    if (winLine(b, mv.x, mv.y)) return { winner: p, moves, maxT };
  }
  return { winner: 0, moves, maxT };
}

let globalMax = 0;

/* 1) 专家 vs 简单 ×6（阈值 ≥5/6；简单带随机性，6/6 才是常态） */
let w1 = 0;
for (let g = 0; g < 6; g++) {
  const ec = g % 2 === 0 ? BLACK : WHITE;
  const r = benchPlay(...(ec === BLACK ? ['expert', 'easy'] : ['easy', 'expert']));
  globalMax = Math.max(globalMax, r.maxT);
  if (r.winner === ec) w1++;
}
console.log('专家 vs 简单 : ' + w1 + '/6  (阈值 ≥5)');
check(w1 >= 5, '专家 vs 简单 ' + w1 + '/6 低于阈值 5/6');

/* 2) 专家 vs 中等 ×4（阈值 ≥3/4） */
let w2 = 0;
for (let g = 0; g < 4; g++) {
  const ec = g % 2 === 0 ? BLACK : WHITE;
  const r = benchPlay(...(ec === BLACK ? ['expert', 'medium'] : ['medium', 'expert']));
  globalMax = Math.max(globalMax, r.maxT);
  if (r.winner === ec) w2++;
}
console.log('专家 vs 中等 : ' + w2 + '/4  (阈值 ≥3)');
check(w2 >= 3, '专家 vs 中等 ' + w2 + '/4 低于阈值 3/4');

/* 3) 安静中盘耗时（hard 预算 550ms / expert 预算 900ms，允许 400ms 机器余量） */
const b = makeBoard();
const P = (x, y, p) => { b[idx(x, y)] = p; };
P(3,3,BLACK); P(5,5,BLACK); P(7,7,BLACK); P(9,6,BLACK); P(11,9,BLACK); P(6,10,BLACK); P(12,13,BLACK);
P(4,10,WHITE); P(6,4,WHITE); P(8,5,WHITE); P(9,8,WHITE); P(11,7,WHITE); P(5,12,WHITE); P(13,11,WHITE);
const budgets = { hard: 550, expert: 900 };
for (const d of ['hard', 'expert']) {
  let max = 0, sum = 0;
  for (const p of [BLACK, WHITE]) for (let k = 0; k < 3; k++) {
    const bc = Uint8Array.from(b);
    const t0 = Date.now();
    chooseAiMove(bc, d, p);
    const dt = Date.now() - t0;
    max = Math.max(max, dt); sum += dt;
    globalMax = Math.max(globalMax, dt);
  }
  const avg = Math.round(sum / 6);
  console.log('中盘 ' + d + ': 平均 ' + avg + 'ms, 最大 ' + max + 'ms  (预算 ' + budgets[d] + 'ms)');
  check(avg <= budgets[d] + 400, d + ' 中盘平均 ' + avg + 'ms 超出预算余量 ' + (budgets[d] + 400) + 'ms');
}

/* 4) 单步硬上限 */
console.log('全局单步最大 : ' + globalMax + 'ms  (阈值 1500ms)');
check(globalMax <= 1500, '单步最大 ' + globalMax + 'ms 超过 1500ms');

if (failures.length) {
  console.error('BENCH FAIL:');
  for (const f of failures) console.error('  x ' + f);
  process.exit(1);
}
console.log('tests/bench.js: PASS');
process.exit(0);
`;

try {
  new Function(src.slice(0, entry) + bench)();
} catch (e) {
  console.error('FAIL:', (e && e.stack) || e);
  process.exit(1);
}
