#!/usr/bin/env node
/* YiMoku — DOM 交互冒烟测试（需要 devDependency：jsdom）
 *
 * 在无头 DOM 中启动真实的 index.html 并端到端驱动：
 * 首次玩法说明 → 落子与 AI 应手 → 撤销一对 → 模式/难度/执子切换 →
 * 主题与配色弹层 → 菜单/战绩/清除记录 → 键盘操作 → 五连高亮与
 * 三种结果条文案（人机玩家胜 / 人机 AI 胜 / 双人胜）；另用可控假 Worker
 * 验证在途取消、过期消息、资源释放以及失败后的主线程回退。
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

  /* ---- 关闭态的弹层/模态不可被键盘聚焦（visibility:hidden）---- */
  const vis = id => window.getComputedStyle($(id)).visibility;
  ['palettePop', 'menuPop', 'modalHelp', 'modalRecords', 'modalClear'].forEach(id =>
    assert(vis(id) === 'hidden', id + ' 关闭时应为 visibility:hidden（实际：' + vis(id) + '）'));
  assert($('menuBtn').getAttribute('aria-expanded') === 'false', '菜单关闭时 aria-expanded=false');
  click($('menuBtn'));
  assert(vis('menuPop') === 'visible', '菜单打开时可见');
  assert($('menuBtn').getAttribute('aria-expanded') === 'true', '菜单打开时 aria-expanded=true');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!$('menuPop').classList.contains('open'), 'Esc 关闭菜单');
  assert($('menuBtn').getAttribute('aria-expanded') === 'false', '菜单关闭后 aria-expanded 复位');
  assert(document.activeElement === $('menuBtn'), 'Esc 关闭弹层后焦点回到触发按钮');
  /* 药丸选中态要暴露给读屏 */
  const pressed = sel => [...document.querySelectorAll(sel)].filter(b => b.getAttribute('aria-pressed') === 'true').length;
  assert(pressed('[data-mode]') === 1 && pressed('[data-diff]') === 1 && pressed('[data-side]') === 1,
    '每组药丸恰有一个 aria-pressed=true');

  /* ---- 模态框焦点管理：移入、Tab 循环、Esc 后归还 ---- */
  const key = (k, extra) => document.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  $('menuBtn').focus(); click($('menuBtn'));
  $('mClear').focus(); click($('mClear'));
  assert($('modalClear').classList.contains('open'), '菜单「清除记录」打开确认框');
  assert(document.activeElement === $('clearCancel'), '确认框打开后焦点落在「取消」（实际：' + (document.activeElement && document.activeElement.id) + '）');
  $('clearConfirm').focus(); key('Tab');
  assert(document.activeElement === $('clearCancel'), '末个按钮按 Tab 回到首个');
  key('Tab', { shiftKey: true });
  assert(document.activeElement === $('clearConfirm'), '首个按钮按 Shift+Tab 回到末个');
  key('Escape');
  assert(!$('modalClear').classList.contains('open'), 'Esc 关闭确认框');
  assert(document.activeElement === $('menuBtn'), '确认框关闭后焦点回到菜单按钮（实际：' + (document.activeElement && document.activeElement.id) + '）');

  /* ---- 落子 + AI 应手 ---- */
  click(document.querySelector('.cell[data-x="7"][data-y="7"]'));
  let stones = [...document.querySelectorAll('.cell')].filter(c => c.classList.contains('on'));
  assert(stones.length === 1, '点击后落下 1 子（人执黑）');
  assert($('moveVal').textContent === '1', '手数 = 1');
  const h8 = document.querySelector('.cell[data-x="7"][data-y="7"]');
  assert(h8.getAttribute('aria-label') === 'H8，黑棋', '落子后格子标签含棋色（实际：' + h8.getAttribute('aria-label') + '）');
  assert(document.querySelector('.cell[data-x="0"][data-y="0"]').getAttribute('aria-label') === 'A1', '空格标签仅含坐标');
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
  assert(h8.getAttribute('aria-label') === 'H8', '撤销后标签恢复为纯坐标');
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
  click($('undoBtn'));
  assert(document.querySelectorAll('.cell.on').length === 0, '双人撤销到空盘');
  assert(window.eval('S.started === false && S.timerRun === false && S.acc === 0'),
    '撤销到空盘后计时清零并停表');
  assert($('statusSub').textContent.includes('点击棋盘开始'), '撤销到空盘后恢复开局提示');

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
  assert($('themeBtn').getAttribute('aria-pressed') === 'false', '浅色主题时主题按钮 aria-pressed=false');
  assert($('themeBtn').getAttribute('aria-label') === '深色模式', '主题开关的名称固定为功能名，不随状态变化');
  click($('themeBtn'));
  assert(document.documentElement.dataset.theme === 'dark', '切换到深色');
  assert($('themeBtn').getAttribute('aria-pressed') === 'true', '深色主题时主题按钮 aria-pressed=true');
  assert(window.getComputedStyle(document.documentElement).getPropertyValue('color-scheme') === 'dark',
    '原生控件配色（color-scheme）跟随所选主题');
  click($('paletteBtn'));
  assert($('palettePop').classList.contains('open'), '配色面板打开');
  assert(document.querySelectorAll('.swatch').length === 8, '8 个配色');
  assert([...document.querySelectorAll('.swatch')].every(b => (b.getAttribute('aria-label') || '').trim() !== ''),
    '每个配色色块都有 aria-label（仅有图标，无可见文字）');
  click(document.querySelector('.swatch[data-accent="teal"]'));
  assert(document.documentElement.dataset.accent === 'teal', '切换配色为青');
  assert(!$('palettePop').classList.contains('open'), '选择后面板关闭');

  /* ---- 菜单与弹窗 ---- */
  click($('menuBtn'));
  assert($('soundText').textContent === '落子音效：开', '默认音效开');
  assert($('mSound').getAttribute('role') === 'menuitemcheckbox' && $('mSound').getAttribute('aria-checked') === 'true',
    '音效开关应为 menuitemcheckbox 且初始 aria-checked=true');
  click($('mSound'));
  assert($('soundText').textContent === '落子音效：关', '切换音效关');
  assert($('mSound').getAttribute('aria-checked') === 'false', '音效关时 aria-checked=false');
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
  /* 焦点在链接上时回车归浏览器处理（跳转），不能被拦截成落子 */
  const linkEnter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  document.querySelector('footer a').dispatchEvent(linkEnter);
  assert(!linkEnter.defaultPrevented, '链接上的回车不被拦截');
  /* 光标从 H8 移到 L9：AI 的应手只会落在 H8 两格以内，L9 必为空点 */
  $('restartBtn').focus();                       // 模拟刚用鼠标点过棋盘外的按钮
  kd('ArrowRight'); kd('ArrowRight'); kd('ArrowRight'); kd('ArrowDown');
  assert($('board').classList.contains('showcur'), '方向键后显示光标');
  assert(document.activeElement === document.querySelector('.cell.cursor'),
    '方向键后焦点跟随光标，空格/回车不会再激活此前聚焦的按钮');
  const tabStops = [...document.querySelectorAll('.cell')].filter(c => c.tabIndex === 0);
  assert(tabStops.length === 1 && tabStops[0] === document.querySelector('.cell.cursor'),
    '棋盘只占一个 Tab 停靠点且跟随光标（实际：' + tabStops.length + ' 个）');
  const stonesBefore = document.querySelectorAll('.cell.on').length;
  kd(' ');
  assert(document.querySelectorAll('.cell.on').length === stonesBefore + 1 &&
    document.querySelector('.cell[data-x="10"][data-y="8"]').classList.contains('on1'), '空格在光标处落子');

  /* ---- 光标停在已有棋子上时，不得用半透明的落子预览盖住它 ---- */
  click(document.querySelector('[data-mode="pvp"]'));
  kd('ArrowLeft'); kd(' ');
  const curStone = document.querySelector('.cell.cursor.on1 .s');
  assert(curStone && window.getComputedStyle(curStone).opacity === '1',
    '光标下的棋子保持不透明（实际：' + (curStone && window.getComputedStyle(curStone).opacity) + '）');
  kd('r');

  /* ---- 弹层打开时，棋盘快捷键不得穿透到背后的棋盘 ---- */
  click(document.querySelector('.cell[data-x="0"][data-y="0"]'));
  const stonesPop = document.querySelectorAll('.cell.on').length;
  assert(stonesPop === 1, '穿透测试前提：盘上有 1 子（实际：' + stonesPop + '）');
  click($('menuBtn'));
  assert($('menuPop').classList.contains('open'), '菜单已打开');
  const curBefore = window.eval('S.cursor.x + "," + S.cursor.y');
  kd('r', $('mHelp'));
  assert(document.querySelectorAll('.cell.on').length === stonesPop, '菜单打开时 R 键不得重开对局');
  kd('z', $('mHelp'));
  assert(document.querySelectorAll('.cell.on').length === stonesPop, '菜单打开时 Z 键不得悔棋');
  kd('ArrowRight', $('mHelp'));
  assert(window.eval('S.cursor.x + "," + S.cursor.y') === curBefore, '菜单打开时方向键不得移动棋盘光标');
  kd('h', $('mHelp'));
  assert(!$('modalHelp').classList.contains('open'), '菜单打开时 H 键不得穿透打开说明');
  kd('Escape');
  assert(!$('menuPop').classList.contains('open'), '菜单仍可用 Esc 关闭');
  kd('r');
  assert(document.querySelectorAll('.cell.on').length === 0, '菜单关闭后 R 键恢复重开');

  /* ---- 双人五连胜利渲染 ---- */
  click(document.querySelector('[data-mode="pvp"]'));
  const seq = [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[4,0]];
  for (const [x, y] of seq) click(document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`));
  assert($('resultBar').classList.contains('show'), '胜利结果条显示');
  assert($('resultText').textContent.includes('黑棋获胜'), '双人文案：黑棋获胜');
  assert(document.querySelectorAll('.cell.win').length === 5, '高亮 5 连');
  /* 终局后方向键仍能在盘内移动焦点：游走 tabindex 下这是键盘到达其他格子的唯一途径 */
  kd('ArrowRight');
  assert(document.activeElement === document.querySelector('.cell[data-x="5"][data-y="0"]') &&
    document.activeElement.tabIndex === 0, '终局后方向键仍可移动棋盘焦点');
  assert(parseInt($('recTotal').textContent) === 1, '清除后新记录 +1');
  assert($('statusStone').classList.contains('on1') && !$('statusStone').classList.contains('on2'),
    '黑棋获胜时状态卡显示黑子');

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

    // 测试「清除记录」后终局悔棋不恢复旧战绩
    // 此时已有 1 局战绩
    S.records = freshRecords();
    S.lastRecordSnapshot = null;
    store.setJSON("records", S.records);
    renderRecords();
    if (S.records.total !== 0) throw new Error("清除后战绩应为 0");
    undo();
    if (S.records.total !== 0) throw new Error("清除记录后终局悔棋不应恢复已清除的旧战绩");

  `);

  /* ---- 最快取胜：手数相同时，用时更短的一局应刷新纪录 ---- */
  window.eval(`
    restartGame();
    S.mode = "ai"; S.side = 1;
    S.records.best = { moves: 9, ms: 600000, diff: "easy" };
    for (let k = 0; k < 5; k++) {
      doMove(k, 0);
      if (k < 4) doMove(k, 1);
    }
    if (S.records.best.moves !== 9 || S.records.best.ms >= 600000) {
      throw new Error("同为 9 手但更快的胜局未刷新最快取胜");
    }
  `);

  kd('r');
  assert(document.querySelectorAll('.cell.on').length === 0, 'R 键重开清盘');
  assert(!$('resultBar').classList.contains('show'), '结果条隐藏');

  /* ---- 弹层打开时的外部点击只关闭弹层，不得穿透到棋盘 ---- */
  window.eval('restartGame()');
  click($('paletteBtn'));
  assert($('palettePop').classList.contains('open'), '配色面板已打开');
  click(document.querySelector('.cell[data-x="0"][data-y="0"]'));
  assert(document.querySelectorAll('.cell.on').length === 0, '面板打开时点击棋盘不得落子');
  assert(!$('palettePop').classList.contains('open'), '外部点击关闭配色面板');

  /* ---- 重开清掉棋谱高亮，空盘上不得残留闪框 ---- */
  click(document.querySelector('.cell[data-x="7"][data-y="7"]'));
  click($('mList').children[0]);
  assert(document.querySelector('.cell[data-x="7"][data-y="7"]').classList.contains('flash'), '棋谱高亮已点亮');
  click($('restartBtn'));
  assert(document.querySelectorAll('.cell.flash').length === 0, '重开后清除棋谱高亮');

  /* ---- 计时只在显示的秒数变化时写 DOM ---- */
  {
    const clock = $('timeVal');
    const proto = Object.getOwnPropertyDescriptor(window.Node.prototype, 'textContent');
    let writes = 0;
    Object.defineProperty(clock, 'textContent', {
      configurable: true,
      get() { return proto.get.call(this); },
      set(v) { writes++; proto.set.call(this, v); },
    });
    window.eval('S.timerRun = false; S.acc = 0; updateTime();');
    writes = 0;
    window.eval('S.acc = 61000; updateTime(); updateTime();');
    assert(writes === 1 && /01:01/.test(clock.textContent), '同一秒内只写一次计时（实际 ' + writes + ' 次）');
    window.eval('S.acc = 62000; updateTime();');
    assert(writes === 2 && /01:02/.test(clock.textContent), '秒数变化后写计时（实际 ' + writes + ' 次）');
    delete clock.textContent;
  }

  /* ---- 计时刷新只在计时进行中挂着：开局前 / 重开后不得空转 ---- */
  window.eval(`
    window.__keepMode = S.mode;
    S.mode = 'pvp'; restartGame();
    if (clockTick !== null) throw new Error('开局前不应挂着计时刷新');
    doMove(0, 0);
    if (clockTick === null) throw new Error('开始计时后应挂上计时刷新');
    restartGame();
    if (clockTick !== null) throw new Error('重开后应摘掉计时刷新');
    S.mode = window.__keepMode; restartGame();
  `);

  /* ---- Worker 生命周期：可控计时与消息，避免依赖真实搜索速度 ---- */
  function workerFixture(options = {}) {
    const workers = [], activeURLs = new Set(), timers = new Map();
    let nextTimer = 0, nextURL = 0, creates = 0;
    const workerDom = new JSDOM(html, {
      url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w) {
        w.localStorage.setItem('yimoku:seenHelp', '1');
        w.setTimeout = fn => { const id = ++nextTimer; timers.set(id, fn); return id; };
        w.clearTimeout = id => timers.delete(id);
        w.URL.createObjectURL = () => { const url = 'blob:test-' + ++nextURL; activeURLs.add(url); return url; };
        w.URL.revokeObjectURL = url => activeURLs.delete(url);
        w.Worker = class {
          constructor(url) {
            if (++creates === options.failCreateAt) throw new Error('Worker construction failed');
            this.url = url; this.messages = []; this.terminated = false; workers.push(this);
          }
          postMessage(message) {
            if (options.throwOnPost) throw new Error('postMessage failed');
            this.messages.push(message);
          }
          terminate() { this.terminated = true; }
        };
      },
    });
    const w = workerDom.window, d = w.document;
    return {
      w, d, workers, activeURLs,
      move(x, y) { d.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`).click(); },
      tick() {
        const id = w.eval('S.aiTimer'), fn = timers.get(id);
        assert(typeof fn === 'function', 'AI 应有一个待执行的计时器');
        timers.delete(id); fn();
      },
      watchdog() { return timers.get(w.eval('aiWorkerWatchdog')); },
      tickWatchdog() {
        const id = w.eval('aiWorkerWatchdog'), fn = timers.get(id);
        assert(typeof fn === 'function', '在途 Worker 应有超时保护');
        timers.delete(id); fn();
      },
      close() { w.close(); },
    };
  }
  {
    const f = workerFixture(), { w, d, workers, activeURLs } = f;
    const first = workers[0];
    f.move(7, 7);
    w.eval('undo()');
    assert(workers.length === 1 && !first.terminated, '仅取消延迟时应复用空闲 Worker');
    f.move(7, 7); f.tick();
    const oldRequest = first.messages[0];
    assert(oldRequest && w.eval('S.aiThinking'), 'AI 搜索已投递到 Worker');
    w.eval('undo()');
    assert(first.terminated, '悔棋必须中止正在计算的 Worker');
    assert(!activeURLs.has(first.url), '取消尚未回复的 Worker 时释放 Blob URL');
    assert(workers.length === 2, '取消在途搜索后为下一次搜索创建新 Worker');

    f.move(6, 7); f.tick();
    const second = workers[1];
    assert(second.messages.length === 1, '新局搜索不应排在已取消的搜索后面');
    first.onmessage({ data: { id: oldRequest.id, mv: { x: 8, y: 7 } } });
    first.onerror({});
    assert(d.querySelectorAll('.cell.on').length === 1 && w.eval('S.aiThinking'), '过期消息和错误不得影响新请求');
    w.eval('undo()');
    assert(second.terminated, '过期回调不得清除新 Worker 的在途状态');

    f.move(7, 7); f.tick();
    const third = workers[2], request = third.messages[0];
    third.onmessage({ data: { id: request.id, mv: { x: 8, y: 7 } } });
    assert(d.querySelectorAll('.cell.on').length === 2 && !w.eval('S.aiThinking'), '新 Worker 应正常落子');
    assert(!activeURLs.has(third.url), '收到回复后释放 Blob URL');
    w.eval('undo()');
    assert(!third.terminated && workers.length === 3, '正常回复后悔棋应复用空闲 Worker');
    f.close();
  }
  for (const operation of ['restartGame()', 'setMode("pvp")', 'setSide(2)']) {
    const f = workerFixture(), { w, d, workers, activeURLs } = f;
    f.move(7, 7); f.tick();
    const old = workers[0], request = old.messages[0];
    w.eval(operation);
    assert(old.terminated && !activeURLs.has(old.url) && workers.length === 2, operation + '应取消在途搜索');
    old.onmessage({ data: { id: request.id, mv: { x: 8, y: 7 } } });
    assert(d.querySelectorAll('.cell.on').length === 0, operation + '后不得接受旧局的着法');
    if (operation === 'setSide(2)') {
      f.tick();
      const opening = workers[1].messages[0];
      assert(opening && opening.aiP === 1 && opening.board.every(v => v === 0), '执白新局应立即向新 Worker 请求黑棋首手');
      workers[1].onmessage({ data: { id: opening.id, mv: { x: 7, y: 7 } } });
      assert(d.querySelectorAll('.cell.on1').length === 1 && !w.eval('S.aiThinking'), 'AI 首手应正确落在新局');
    }
    f.close();
  }
  for (const failCreateAt of [1, 2]) {
    const f = workerFixture({ failCreateAt }), { w, d, workers, activeURLs } = f;
    if (failCreateAt === 2) {
      f.move(7, 7); f.tick(); w.eval('undo()');
      assert(workers[0].terminated, '重建失败前必须中止旧 Worker');
    }
    assert(w.eval('S.aiWorker === null') && activeURLs.size === 0, '构造失败时回退并释放 Blob URL');
    f.move(7, 7); f.tick();
    assert(d.querySelectorAll('.cell.on').length === 2 && !w.eval('S.aiThinking'), '构造失败后主线程仍能应手');
    f.close();
  }
  {
    const f = workerFixture({ throwOnPost: true }), { w, d, workers, activeURLs } = f;
    f.move(7, 7); f.tick();
    assert(workers[0].terminated && !activeURLs.has(workers[0].url), 'postMessage 抛错时销毁 Worker 并释放 URL');
    assert(w.eval('S.aiThinking && S.aiWorker === null'), 'postMessage 抛错时重新排程主线程回退');
    f.tick();
    assert(d.querySelectorAll('.cell.on').length === 2 && !w.eval('S.aiThinking'), 'postMessage 抛错后仍可完成 AI 应手');
    f.close();
  }
  for (const [name, response] of [
    ['Worker 运行错误', 'onerror'],
    ['消息反序列化失败', 'onmessageerror'],
    ['空着法', { mv: null }],
    ['越界着法', { mv: { x: -1, y: 0 } }],
    ['小数着法', { mv: { x: 1.5, y: 0 } }],
    ['已有棋子', { mv: { x: 7, y: 7 } }],
  ]) {
    const f = workerFixture(), { w, d, workers, activeURLs } = f;
    f.move(7, 7); f.tick();
    const worker = workers[0], request = worker.messages[0];
    if (typeof response === 'string') {
      assert(typeof worker[response] === 'function', '应处理' + name);
      worker[response]({});
    } else worker.onmessage({ data: { id: request.id, ...response } });
    assert(worker.terminated && !activeURLs.has(worker.url), name + '应释放失效 Worker');
    assert(d.querySelectorAll('.cell.on').length === 1 && w.eval('S.aiThinking && S.aiWorker === null'),
      name + '不得污染棋盘或卡死，应重新排程回退');
    f.tick();
    assert(d.querySelectorAll('.cell.on').length === 2 && !w.eval('S.aiThinking'), name + '后主线程仍能应手');
    f.close();
  }

  /* Worker 不报错也不回复时，超时后必须放弃它并继续对局。 */
  {
    const f = workerFixture(), { w, d, workers, activeURLs } = f;
    f.move(7, 7); f.tick();
    const worker = workers[0], request = worker.messages[0], lateWatchdog = f.watchdog();
    assert(typeof lateWatchdog === 'function', 'Worker 投递后必须启动超时保护');
    worker.onmessage({ data: { id: request.id + 1, mv: { x: 8, y: 7 } } });
    assert(f.watchdog() === lateWatchdog, '无关消息不能取消当前请求的超时保护');
    f.tickWatchdog();
    assert(worker.terminated && !activeURLs.has(worker.url), '超时必须终止 Worker 并释放 URL');
    assert(w.eval('S.aiThinking && S.aiWorker === null'), '超时后应排程主线程回退');
    worker.onmessage({ data: { id: request.id, mv: { x: 8, y: 7 } } });
    f.tick();
    assert(d.querySelectorAll('.cell.on').length === 2 && !w.eval('S.aiThinking'), '超时回退后正常落子');
    assert(w.eval('S.moves.length') === 2, '过期回复不得额外落子');
    f.close();
  }
  {
    const f = workerFixture(), { w, workers } = f;
    f.move(7, 7); f.tick();
    const first = workers[0], stale = f.watchdog(), request = first.messages[0];
    first.onmessage({ data: { id: request.id, mv: { x: 8, y: 7 } } });
    assert(!f.watchdog(), '成功回复后应清除超时计时器');
    stale();
    assert(!first.terminated && !w.eval('S.aiThinking'), '过期超时回调不得影响已完成的请求');
    w.eval('undo()'); f.move(7, 7); f.tick();
    const cancelled = f.watchdog();
    w.eval('undo()');
    assert(!f.watchdog(), '悔棋取消在途请求后应清除超时计时器');
    f.move(6, 7); f.tick();
    cancelled();
    assert(workers.length === 2 && !workers[1].terminated && w.eval('S.aiThinking'),
      '旧请求的超时回调不得终止新 Worker');
    f.close();
  }
  /* 主线程引擎的异常、非法返回及中途改盘也不得污染兜底着法。 */
  for (const expression of [
    'return {x:7,y:7}', 'return {x:-1,y:0}', 'return {x:1.5,y:0}',
    'b[97] = 2; throw new Error("engine failed after a temporary move")',
    'b[97] = 2; return null',
  ]) {
    const f = workerFixture({ failCreateAt: 1 }), { w, d } = f;
    w.eval('chooseAiMove = function(b) { ' + expression + '; }; scoreCell = function() { throw new Error("score failed"); };');
    f.move(7, 7); f.tick();
    assert(d.querySelectorAll('.cell.on').length === 2 && !w.eval('S.aiThinking'),
      '非法返回或异常后必须落下一手合法棋：' + expression);
    assert(w.eval('S.board[97]') === 2, '兜底必须根据未被引擎污染的棋盘选择最近空点：' + expression);
    f.close();
  }

  /* ---- 模态关闭不滞留焦点，且无归还目标时跨模态切换不指向已关闭模态内部 ---- */
  {
    document.activeElement.blur();
    window.eval('openModal("modalHelp")');
    assert(document.activeElement === $('helpOk'), '打开说明后聚焦「知道了」');
    click($('helpOk'));
    assert(!$('modalHelp').contains(document.activeElement), '无归还目标关闭模态后焦点必须移出隐藏模态');
    window.eval('openModal("modalRecords")');
    $('recClear').focus();
    click($('recClear'));
    assert($('modalClear').classList.contains('open') && !$('modalRecords').classList.contains('open'), '切至清除确认框');
    click($('clearCancel'));
    assert(!$('modalRecords').contains(document.activeElement) && !$('modalClear').contains(document.activeElement),
      '确认框关闭后焦点不得回到已关闭的成绩弹窗内部');
  }

  /* ---- 指针点击棋盘清除键盘光标环 ---- */
  {
    window.eval('setMode("pvp"); restartGame();');
    kd('ArrowRight');
    assert($('board').classList.contains('showcur'), '方向键唤出键盘光标');
    const c33 = document.querySelector('.cell[data-x="3"][data-y="3"]');
    c33.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert(!$('board').classList.contains('showcur') && !c33.classList.contains('cursor'),
      '鼠标/触屏点击落子后应隐藏键盘光标环');
    kd('ArrowLeft');
    assert($('board').classList.contains('showcur'), '再次按方向键重新显示光标');
    $('board').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert(!$('board').classList.contains('showcur'), 'pointerdown 立即收起键盘光标环');
  }

  /* ---- 弹层内方向键导航、外部链接点击拦截、快捷键修饰键与长按防重 ---- */
  {
    window.eval('setMode("pvp"); restartGame();');
    click($('menuBtn'));
    assert(document.activeElement === $('mSound'), '打开菜单聚焦首项');
    key('ArrowDown');
    assert(document.activeElement === $('mHelp'), '菜单 ArrowDown 移至下一项');
    key('End');
    assert(document.activeElement === $('mClear'), '菜单 End 移至末项');
    key('Home');
    assert(document.activeElement === $('mSound'), '菜单 Home 回到首项');
    const outLinkClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('footer a').dispatchEvent(outLinkClick);
    assert(outLinkClick.defaultPrevented && !$('menuPop').classList.contains('open'),
      '弹层打开时点击外部链接只关闭弹层并阻止默认跳转');

    click($('paletteBtn'));
    const sw = [...document.querySelectorAll('.swatch')];
    sw[0].focus();
    key('ArrowDown');
    assert(document.activeElement === sw[4], '配色面板 ArrowDown 按 4 列跳到下一行');
    key('Escape');

    click(document.querySelector('.cell[data-x="7"][data-y="7"]'));
    click(document.querySelector('.cell[data-x="8"][data-y="8"]'));
    assert(document.querySelectorAll('.cell.on').length === 2, '快捷键测试前提：2 子');
    key('z', { ctrlKey: true, shiftKey: true });
    assert(document.querySelectorAll('.cell.on').length === 2, 'Ctrl+Shift+Z（重做）不得触发悔棋');
    key('z', { repeat: true });
    assert(document.querySelectorAll('.cell.on').length === 2, '长按 Z 自动连发不得连续悔棋');
    key('r', { repeat: true });
    assert(document.querySelectorAll('.cell.on').length === 2, '长按 R 自动连发不得反复重开');
    const hEv = new window.KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true });
    document.body.dispatchEvent(hEv);
    assert(hEv.defaultPrevented && $('modalHelp').classList.contains('open'), 'H 键打开说明并阻止浏览器默认快搜');
    click($('helpOk'));
  }

  /* ---- 终局 70ms 内悔棋/重开取消胜利庆祝定时器 + 挂起音频恢复拒绝静默处理 ---- */
  {
    let vibrateWin = 0;
    const origVib = window.navigator.vibrate;
    window.navigator.vibrate = pat => { if (Array.isArray(pat)) vibrateWin++; return true; };
    let unhandled = 0;
    const origAC = window.AudioContext;
    window.AudioContext = class {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
      resume() { return Promise.reject(new Error('NotAllowedError')).catch(e => { throw e; }); }
      createBuffer() { return { getChannelData: () => new Float32Array(56) }; }
      createBufferSource() { return { connect() {}, start() {} }; }
      createBiquadFilter() { return { frequency: { setValueAtTime() {} }, Q: { setValueAtTime() {} }, connect() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    };
    const onRej = () => { unhandled++; };
    process.on('unhandledRejection', onRej);
    window.eval('audioCtx = null; S.sound = true; setMode("pvp"); restartGame();');
    for (const [x, y] of [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1],[3,0],[3,1],[4,0]]) {
      click(document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`));
    }
    window.eval('undo()');
    await sleep(110);
    assert(vibrateWin === 0, '终局后立即悔棋应取消延迟的胜利震动/音效（实际触发：' + vibrateWin + '）');
    assert(unhandled === 0, 'AudioContext.resume() 被策略拒绝时不得产生未捕获 Promise 拒绝');
    process.off('unhandledRejection', onRej);
    window.AudioContext = origAC;
    window.navigator.vibrate = origVib;
  }

  /* ---- 跨标签页 storage 事件同步主题、配色与音效 ---- */
  {
    window.localStorage.setItem('yimoku:theme', 'light');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'yimoku:theme' }));
    assert(document.documentElement.dataset.theme === 'light', 'storage 同步浅色主题');
    window.localStorage.setItem('yimoku:accent', 'orange');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'yimoku:accent' }));
    assert(document.documentElement.dataset.accent === 'orange' &&
      document.querySelector('.swatch[data-accent="orange"]').classList.contains('on'), 'storage 同步配色与色块状态');
    window.localStorage.setItem('yimoku:sound', '0');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'yimoku:sound' }));
    assert($('soundText').textContent === '落子音效：关', 'storage 同步音效开关');
    assert($('mSound').getAttribute('aria-checked') === 'false', 'storage 同步后 aria-checked 一并更新');
  }

  /* ---- 引擎抛错兜底：AI 仍要落下一手合法棋，不能让 aiThinking 卡死棋盘 ---- */
  {
    window.eval('setMode("ai"); setSide(1); setDiff("easy"); restartGame();');
    const realChoose = window.eval('chooseAiMove');
    window.eval('chooseAiMove = function () { throw new Error("engine boom"); };');
    click(document.querySelector('.cell[data-x="7"][data-y="7"]'));
    assert(window.eval('S.aiThinking') === true, '人类落子后 AI 进入思考态');
    await sleep(400);
    assert(window.eval('S.aiThinking') === false, '引擎抛错后 aiThinking 必须复位');
    assert(window.eval('S.moves.length') === 2, '引擎抛错后 AI 仍应落下一手（实际手数：' + window.eval('S.moves.length') + '）');
    assert(window.eval('S.moves[1].p') === 2 && window.eval('S.board[S.moves[1].i]') === 2, '兜底着法必须是白方的合法落点');
    assert(/轮到你/.test($('statusText').textContent), '兜底落子后状态卡回到玩家回合（实际：' + $('statusText').textContent + '）');
    /* 单步评分也不可用时，退回离中心最近的空点 */
    const realScore = window.eval('scoreCell');
    window.eval('scoreCell = function () { throw new Error("score boom"); };');
    click(document.querySelector('.cell[data-x="0"][data-y="0"]'));
    await sleep(400);
    assert(window.eval('S.moves.length') === 4 && window.eval('S.aiThinking') === false, '评分函数同样失效时仍要落子且复位思考态');
    /* 引擎返回非法或已占格着法时，safeAiMove 同样应回退合法空点 */
    window.scoreCell = realScore;
    window.chooseAiMove = function () { return { x: 7, y: 7, i: 112 }; };
    click(document.querySelector('.cell[data-x="1"][data-y="0"]'));
    await sleep(400);
    assert(window.eval('S.moves.length') === 6 && window.eval('S.aiThinking') === false, '引擎返回已占格着法时仍应回退合法空点');
    window.chooseAiMove = realChoose;
    assert(window.eval('chooseAiMove') === realChoose && window.eval('scoreCell') === realScore, '测试结束后应恢复原引擎函数');
    window.eval('restartGame()');
  }

  /* 自动填充等合成的 keydown 不是 KeyboardEvent（没有 key），IME 组字按键也不是快捷键 */
  {
    const errs = [];
    const onErr = e => errs.push(e.message);
    window.addEventListener('error', onErr);
    document.dispatchEvent(new window.Event('keydown', { bubbles: true }));
    const n0 = window.eval('S.moves.length');
    key('h', { isComposing: true });
    window.removeEventListener('error', onErr);
    assert(errs.length === 0, '无 key 的 keydown 不应抛错（实际：' + errs.join('; ') + '）');
    assert(window.eval('S.moves.length') === n0 && !$('modalHelp').classList.contains('open'), 'IME 组字中的按键不应触发快捷键');
  }

  /* ---- 修饰键组合在模态框与弹层中不应被拦截 ---- */
  {
    window.eval('openModal("modalHelp")');
    const ctrlTab = new window.KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ctrlTab);
    assert(!ctrlTab.defaultPrevented, '模态框内 Ctrl+Tab 不应被拦截');
    click($('helpOk'));

    click($('menuBtn'));
    const altLeft = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(altLeft);
    assert(!altLeft.defaultPrevented, '弹层内 Alt+ArrowLeft 不应被拦截');
    const ctrlHome = new window.KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ctrlHome);
    assert(!ctrlHome.defaultPrevented, '弹层内 Ctrl+Home 不应被拦截');
    key('Escape');
  }

  /* ---- matchMedia 返回 null 或抛错时页面仍能正常初始化 ---- */
  for (const [label, mm] of [['返回 null', () => null], ['抛错', () => { throw new Error('no matchMedia'); }]]) {
    const mmDom = new JSDOM(html, {
      url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(w) {
        w.localStorage.setItem('yimoku:seenHelp', '1');
        w.matchMedia = mm;
      }
    });
    assert(mmDom.window.document.querySelectorAll('.cell').length === 225, 'matchMedia ' + label + ' 时仍能生成 225 格棋盘');
    assert(mmDom.window.document.documentElement.dataset.theme === 'light', 'matchMedia ' + label + ' 时回落浅色主题');
    mmDom.window.close();
  }

  console.log('tests/smoke.js: PASS');
  process.exit(0);
})().catch(e => { console.error('FAIL (exception):', e); process.exit(1); });
