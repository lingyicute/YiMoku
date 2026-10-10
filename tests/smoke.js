#!/usr/bin/env node
/* YiMoku — DOM 交互冒烟测试（需要 devDependency：jsdom）
 *
 * 在无头 DOM 中启动真实的 index.html 并端到端驱动：
 * 首次玩法说明 → 落子与 AI 应手 → 撤销一对 → 模式/难度/执子切换 →
 * 主题与配色弹层 → 菜单/战绩/清除记录 → 键盘操作 → 五连高亮与
 * 三种结果条文案（人机玩家胜 / 人机 AI 胜 / 双人胜）。
 *
 * 未安装 jsdom 时打印跳过提示并以 0 退出，保证 `npm test` 在
 * 纯克隆环境（无 node_modules）下依然可用。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.warn('SKIP: tests/smoke.js 需要 jsdom —— 先运行 `npm install` 再重试。');
  process.exit(0);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const fail = m => { console.error('FAIL:', m); process.exit(1); };
const assert = (c, m) => { if (!c) fail(m); };

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

(async () => {
  await sleep(60);

  /* ---- 初始化 ---- */
  assert(document.querySelectorAll('.cell').length === 225, '应生成 225 个棋盘格');
  assert(document.documentElement.dataset.theme === 'light', '默认浅色主题');
  assert($('titleSub').textContent === '人机对战 · 简单', '默认副标题：人机对战 · 简单');
  assert($('modalHelp').classList.contains('open'), '首次访问自动打开玩法说明');
  click($('helpOk'));
  assert(!$('modalHelp').classList.contains('open'), '点击「知道了」关闭说明');
  assert(window.localStorage.getItem('yimoku:seenHelp') === '1', '已记录看过说明');

  /* ---- 落子 + AI 应手 ---- */
  click(document.querySelector('.cell[data-x="7"][data-y="7"]'));
  let stones = [...document.querySelectorAll('.cell')].filter(c => c.classList.contains('on'));
  assert(stones.length === 1, '点击后落下 1 子（人执黑）');
  assert($('moveVal').textContent === '1', '手数 = 1');
  await sleep(700);
  stones = [...document.querySelectorAll('.cell')].filter(c => c.classList.contains('on'));
  assert(stones.length === 2, 'AI 已应手（共 2 子）');
  assert($('mList').children.length === 2, '棋谱 2 条');
  // 点击棋谱第 1 条，断言对应格子获得 .flash 高亮类
  click($('mList').children[0]);
  const firstStone = document.querySelector('.cell.on1');
  assert(firstStone && firstStone.classList.contains('flash'), '点击棋谱项应触发棋子高亮闪烁');
  assert($('statusText').textContent.includes('轮到你'), '状态回到玩家回合');

  /* ---- 撤销（人机模式撤一对） ---- */
  click($('undoBtn'));
  stones = [...document.querySelectorAll('.cell')].filter(c => c.classList.contains('on'));
  assert(stones.length === 0, '撤销后回到空盘（撤回双方各一手）');
  assert($('undoBtn').disabled, '无可撤销时按钮禁用');

  /* ---- 双人模式 ---- */
  click(document.querySelector('[data-mode="pvp"]'));
  assert($('diffRow').hidden && $('sideRow').hidden, '双人模式隐藏难度/执子行');
  assert($('titleSub').textContent === '双人同屏', '双人模式副标题：双人同屏');
  click(document.querySelector('.cell[data-x="3"][data-y="3"]'));
  click(document.querySelector('.cell[data-x="4"][data-y="4"]'));
  assert(document.querySelectorAll('.cell.on').length === 2, '双人交替落子');
  click($('undoBtn'));
  assert(document.querySelectorAll('.cell.on').length === 1, '双人撤销一手');

  /* ---- 人机模式 + 执白 ---- */
  click(document.querySelector('[data-mode="ai"]'));
  click(document.querySelector('[data-side="2"]'));
  await sleep(700);
  assert(document.querySelectorAll('.cell.on').length === 1, '执白时 AI 先行落黑');
  click($('undoBtn'));
  assert(document.querySelectorAll('.cell.on').length === 1, 'AI 首手不可撤销');
  click(document.querySelector('[data-side="1"]'));

  /* ---- 难度切换重开 ---- */
  click(document.querySelector('.cell[data-x="7"][data-y="7"]'));
  await sleep(700);
  assert(document.querySelectorAll('.cell.on').length === 2, '切回执黑后重新对局');
  click(document.querySelector('[data-diff="expert"]'));
  assert(document.querySelectorAll('.cell.on').length === 0, '切换难度自动重开空盘');
  assert($('titleSub').textContent === '人机对战 · 专家', '副标题切至：人机对战 · 专家');
  click(document.querySelector('.cell[data-x="7"][data-y="7"]'));
  await sleep(2200);   // 专家：延迟 420ms + 搜索预算 900ms
  assert(document.querySelectorAll('.cell.on').length === 2, '专家 AI 正常应手');

  /* ---- 主题与配色 ---- */
  click($('themeBtn'));
  assert(document.documentElement.dataset.theme === 'dark', '切换到深色');
  click($('paletteBtn'));
  assert($('palettePop').classList.contains('open'), '配色面板打开');
  assert(document.querySelectorAll('.swatch').length === 8, '8 个配色');
  click(document.querySelector('.swatch[data-accent="teal"]'));
  assert(document.documentElement.dataset.accent === 'teal', '切换配色为青');
  assert(!$('palettePop').classList.contains('open'), '选择后面板关闭');

  /* ---- 菜单与弹窗 ---- */
  click($('menuBtn'));
  assert($('soundText').textContent === '落子音效：开', '默认音效开');
  click($('mSound'));
  assert($('soundText').textContent === '落子音效：关', '切换音效关');
  assert(window.localStorage.getItem('yimoku:sound') === '0', '持久化音效关闭');
  click($('mSound'));
  assert($('soundText').textContent === '落子音效：开', '切回音效开');
  click($('mRecords'));
  assert($('modalRecords').classList.contains('open'), '最佳成绩弹窗');
  click($('recClose'));
  click($('menuBtn'));
  click($('mClear'));
  click($('clearConfirm'));
  assert($('recTotal').textContent === '0 局', '记录已清零');

  /* ---- 键盘操作 ---- */
  const kd = (key, target) => (target || document.body)
    .dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  kd('ArrowRight'); kd('ArrowDown');
  assert($('board').classList.contains('showcur'), '方向键后显示光标');
  kd(' ');
  assert(document.querySelectorAll('.cell.on').length >= 1, '空格在光标处落子');

  /* ---- 双人五连胜利渲染 ---- */
  click(document.querySelector('[data-mode="pvp"]'));
  const seq = [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[4,0]];
  for (const [x, y] of seq) click(document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`));
  assert($('resultBar').classList.contains('show'), '胜利结果条显示');
  assert($('resultText').textContent.includes('黑棋获胜'), '双人文案：黑棋获胜');
  assert(document.querySelectorAll('.cell.win').length === 5, '高亮 5 连');
  assert(parseInt($('recTotal').textContent) === 1, '清除后新记录 +1');

  /* ---- 结果条文案（三种） ---- */
  window.eval("restartGame(); S.mode='ai'; S.side=1; S.moves.length=3; endGame(1,null);");
  assert($('resultText').textContent === '你赢了！ · 第 3 手 · 用时 00:00',
    '人机玩家获胜 → 你赢了！（实际：' + $('resultText').textContent + '）');
  window.eval("restartGame(); S.mode='ai'; S.side=1; S.moves.length=5; endGame(2,null);");
  assert($('resultText').textContent === '白棋（AI）获胜 · 第 5 手 · 用时 00:00',
    '人机 AI 获胜 → x棋（AI）获胜（实际：' + $('resultText').textContent + '）');
  window.eval("restartGame(); S.mode='pvp'; S.moves.length=7; endGame(2,null);");
  assert($('resultText').textContent === '白棋获胜 · 第 7 手 · 用时 00:00',
    '双人获胜 → x棋获胜（实际：' + $('resultText').textContent + '）');

  /* ---- 终局悔棋战绩回滚测试 ---- */
  window.eval(`
    restartGame();
    S.mode = "ai"; S.side = 1;
    const initialWins = S.records.ai.win;
    const initialTotal = S.records.total;
    for (let k = 0; k < 5; k++) {
      doMove(k, 0);
      if (k < 4) doMove(k, 1);
    }
    if (S.records.ai.win !== initialWins + 1 || S.records.total !== initialTotal + 1) {
      throw new Error("结算后战绩未正确递增");
    }
    undo();
    if (S.records.ai.win !== initialWins || S.records.total !== initialTotal) {
      throw new Error("终局悔棋后战绩未正确回滚");
    }
    doMove(4, 0);
    if (S.records.ai.win !== initialWins + 1 || S.records.total !== initialTotal + 1) {
      throw new Error("悔棋后再次获胜战绩应只计一次");
    }
  `);

  kd('r');
  assert(document.querySelectorAll('.cell.on').length === 0, 'R 键重开清盘');
  assert(!$('resultBar').classList.contains('show'), '结果条隐藏');

  console.log('tests/smoke.js: PASS');
  process.exit(0);
})().catch(e => { console.error('FAIL (exception):', e); process.exit(1); });
