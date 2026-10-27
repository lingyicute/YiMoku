#!/usr/bin/env node
/* YiMoku — 断点续局测试（需要 devDependency：jsdom；未安装时跳过）
 * 覆盖：页面加载自动读档、落子/悔棋自动写档、畸形存档逐项拒绝、
 * 重开清空存档、非法状态不污染页面。 */
'use strict';
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.warn('SKIP: tests/session.js 需要 jsdom —— 先运行 `npm install` 再重试。');
  process.exit(0);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0;
const failures = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; return; }
  failures.push(name + (extra ? ' — ' + extra : ''));
};
const KEY = 'yimoku:session';

function boot(session) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('yimoku:seenHelp', '1');   // 跳过首次玩法弹窗
      if (session !== undefined) w.localStorage.setItem(KEY, JSON.stringify(session));
    }
  });
  return { w: dom.window, d: dom.window.document, errors, close: () => dom.window.close() };
}
const moveCount = d => parseInt((d.getElementById('mCount').textContent || '').trim(), 10);
const stones = d => [d.querySelectorAll('.cell.on1').length, d.querySelectorAll('.cell.on2').length];
const clickCell = (w, d, x, y) => {
  const el = d.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
};

/* 1) 合法存档：自动恢复棋盘、棋谱、计时与设置 */
{
  const { w, d, errors, close } = boot({
    v: 1, mode: 'pvp', diff: 'hard', side: 1,
    moves: [[7, 7], [8, 8], [7, 8], [8, 7]], acc: 65000
  });
  ok('合法存档：无脚本异常', errors.length === 0, errors.join(' | '));
  ok('合法存档：恢复 4 手', moveCount(d) === 4, String(moveCount(d)));
  ok('合法存档：恢复 2 黑 2 白', stones(d)[0] === 2 && stones(d)[1] === 2, JSON.stringify(stones(d)));
  ok('合法存档：恢复计时 01:05', /01:05/.test(d.getElementById('timeVal').textContent),
     d.getElementById('timeVal').textContent);
  ok('合法存档：双人模式药丸选中', !!d.querySelector('[data-mode="pvp"].on'));
  ok('合法存档：困难难度药丸选中', !!d.querySelector('[data-diff="hard"].on'));
  ok('合法存档：最后一手有标记', d.querySelectorAll('.cell.last').length === 1);
  ok('合法存档：重读后仍持久化', JSON.parse(w.localStorage.getItem(KEY)).moves.length === 4);
  close();
}

/* 2) 落子/悔棋/重开的自动写档 */
{
  const { w, d, close } = boot();
  w.eval('setMode("pvp")');
  clickCell(w, d, 7, 7);
  clickCell(w, d, 8, 8);
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  ok('落子后自动写档', saved && saved.v === 1 && saved.moves.length === 2, JSON.stringify(saved));
  w.eval('undo()');
  const afterUndo = JSON.parse(w.localStorage.getItem(KEY));
  /* 双人模式悔棋只撤 1 手（人机模式才撤一对），所以从 2 手变为 1 手。 */
  ok('悔棋后同步写档', afterUndo && afterUndo.moves.length === 1, JSON.stringify(afterUndo));
  clickCell(w, d, 7, 7);
  d.getElementById('restartBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const raw = w.localStorage.getItem(KEY);
  ok('重开后清空存档', raw === 'null' || raw === null, String(raw));
  close();
}

/* 3) 畸形存档必须被拒绝，且页面仍停在空盘 */
const bad = [
  ['版本号不符', { v: 2, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: 0 }],
  ['空棋谱', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [], acc: 0 }],
  ['非法模式', { v: 1, mode: 'ai-ultra', diff: 'easy', side: 1, moves: [[7, 7]], acc: 0 }],
  ['非法难度', { v: 1, mode: 'pvp', diff: 'godlike', side: 1, moves: [[7, 7]], acc: 0 }],
  ['非法执子', { v: 1, mode: 'pvp', diff: 'easy', side: 9, moves: [[7, 7]], acc: 0 }],
  ['坐标为小数', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7.5, 7]], acc: 0 }],
  ['坐标越界', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[99, 7]], acc: 0 }],
  ['重复落点', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7], [7, 7]], acc: 0 }],
  ['负计时', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: -5 }],
  ['中途已分胜负', { v: 1, mode: 'pvp', diff: 'easy', side: 1,
    moves: [[3, 3], [10, 10], [4, 3], [11, 11], [5, 3], [12, 12], [6, 3], [13, 13], [7, 3]], acc: 0 }],
];
for (const [name, session] of bad) {
  const { d, errors, close } = boot(session);
  ok(`畸形存档「${name}」：空盘`, moveCount(d) === 0, String(moveCount(d)));
  ok(`畸形存档「${name}」：无脚本异常`, errors.length === 0, errors.join(' | '));
  close();
}

if (failures.length) {
  console.error('session: FAIL');
  for (const f of failures) console.error('  x ' + f);
  process.exit(1);
}
console.log(`session: ${pass} passed, 0 failed`);
