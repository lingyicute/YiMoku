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

function boot(session, prefs) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('yimoku:seenHelp', '1');   // 跳过首次玩法弹窗
      if (session !== undefined) w.localStorage.setItem(KEY, JSON.stringify(session));
      for (const k in (prefs || {})) w.localStorage.setItem('yimoku:' + k, prefs[k]);
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

/* 2b) 离开页面时补写计时：最后一手之后的思考用时不能丢 */
{
  const { w, close } = boot({
    v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7], [8, 8]], acc: 65000
  });
  w.eval('S.t0 -= 5000');                            // 模拟又过了 5 秒
  w.dispatchEvent(new w.Event('pagehide'));
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  ok('pagehide 补写计时', saved && saved.acc >= 70000, JSON.stringify(saved));
  w.eval('S.t0 -= 2000');
  Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  const hidden = JSON.parse(w.localStorage.getItem(KEY));
  ok('visibilitychange 连续补写计时', hidden && hidden.acc >= 72000, JSON.stringify(hidden));
  close();
}

/* 2b-2) 后台标签页只能补写自己的存档，不能覆盖另一标签页的新局面或删除操作。 */
{
  const { w, d, close } = boot();
  const other = JSON.stringify({ v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: 5000 });
  w.localStorage.setItem(KEY, other);                  // 模拟另一标签页开始对局
  w.dispatchEvent(new w.Event('pagehide'));
  ok('空白标签页离开：不清除其他对局', w.localStorage.getItem(KEY) === other);
  Object.defineProperty(d, 'visibilityState', { value: 'hidden', configurable: true });
  d.dispatchEvent(new w.Event('visibilitychange'));
  ok('空白标签页转入后台：不清除其他对局', w.localStorage.getItem(KEY) === other);
  close();
}
{
  const { w, d, close } = boot();
  w.eval('setMode("pvp")');
  for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1], [4, 0]]) clickCell(w, d, x, y);
  const other = JSON.stringify({ v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: 5000 });
  w.localStorage.setItem(KEY, other);                  // 终局后另一标签页开始对局
  w.dispatchEvent(new w.Event('pagehide'));
  ok('终局标签页离开：不清除其他对局', w.localStorage.getItem(KEY) === other);
  close();
}
{
  const first = { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: 5000 };
  const { w, d, close } = boot(first);
  const newer = JSON.stringify({ ...first, moves: [[7, 7], [8, 8]], acc: 6000 });
  w.localStorage.setItem(KEY, newer);                  // 模拟另一标签页继续落子
  w.eval('S.t0 -= 5000');
  w.dispatchEvent(new w.Event('pagehide'));
  ok('旧标签页离开：不覆盖较新的棋谱', w.localStorage.getItem(KEY) === newer);
  Object.defineProperty(d, 'visibilityState', { value: 'hidden', configurable: true });
  d.dispatchEvent(new w.Event('visibilitychange'));
  ok('旧标签页转入后台：不覆盖较新的棋谱', w.localStorage.getItem(KEY) === newer);
  w.localStorage.removeItem(KEY);                       // 模拟另一标签页删除存档
  w.dispatchEvent(new w.Event('pagehide'));
  ok('旧标签页离开：不恢复已删除的存档', w.localStorage.getItem(KEY) === null);
  clickCell(w, d, 9, 9);                              // 用户主动继续此局，可以重新写档
  w.eval('S.t0 -= 5000');
  w.dispatchEvent(new w.Event('pagehide'));
  const resumed = JSON.parse(w.localStorage.getItem(KEY));
  ok('主动落子后：重新写档并补写计时', resumed && resumed.moves.length === 2 && resumed.acc >= 15000,
     JSON.stringify(resumed));
  close();
}

/* 2c) 损坏的战绩 / 配色偏好不得渗入界面（NaN、负数、非法配色） */
{
  const { w, d, errors, close } = boot(undefined, {
    records: JSON.stringify({ total: -3, ai: { win: 'x', lose: 2.9, draw: null }, pvp: { b: 1e999, w: 1, draw: 0 },
      best: { moves: 12, ms: 'oops', diff: 'godlike' } }),
    accent: 'not-a-colour',
  });
  const text = ['rAI', 'rPVP', 'rBest', 'recTotal', 'recAI', 'recPVP', 'recBest']
    .map(id => d.getElementById(id).textContent).join('|');
  ok('损坏战绩：无脚本异常', errors.length === 0, errors.join(' | '));
  ok('损坏战绩：界面无 NaN/Infinity', !/NaN|Infinity|undefined/.test(text));
  ok('损坏战绩：负数/非数字归零', d.getElementById('recTotal').textContent === '0 局',
    d.getElementById('recTotal').textContent);
  ok('损坏战绩：小数向下取整', d.getElementById('recAI').textContent === '0 胜 2 负 0 和',
    d.getElementById('recAI').textContent);
  ok('损坏战绩：最快取胜时长回落为 00:00', /12 手 · 00:00（人机）/.test(d.getElementById('recBest').textContent),
    d.getElementById('recBest').textContent);
  ok('非法配色回落为紫罗兰', d.documentElement.dataset.accent === 'purple', d.documentElement.dataset.accent);
  ok('非法配色：色块选中状态正常', d.querySelectorAll('.swatch.on').length === 1);
  close();
}

/* 2d) localStorage 是不可信输入：原型键和无法转换为数字的对象也不得破坏启动。 */
{
  const hostile = { toString: null, valueOf: null };
  const records = [
    ['总局数', { total: hostile }],
    ['AI 胜场', { ai: { win: hostile } }],
    ['双人胜场', { pvp: { b: hostile } }],
    ['最快取胜手数', { best: { moves: hostile } }],
    ['最快取胜时间', { best: { moves: 9, ms: hostile } }],
    ['最快取胜难度', { best: { moves: 9, ms: 100, diff: hostile } }],
  ];
  for (const [name, record] of records) {
    const { d, errors, close } = boot(undefined, { records: JSON.stringify(record) });
    ok(`畸形战绩「${name}」：棋盘可用`, d.querySelectorAll('.cell').length === 225);
    ok(`畸形战绩「${name}」：无脚本异常`, errors.length === 0, errors.join(' | '));
    close();
  }
  for (const diff of ['__proto__', 'constructor', 'toString']) {
    const { d, errors, close } = boot(undefined, {
      diff,
      records: JSON.stringify({ best: { moves: 9, ms: 100, diff } }),
    });
    ok(`原型难度「${diff}」：偏好回退为简单`,
      d.getElementById('titleSub').textContent === '人机对战 · 简单' &&
      !!d.querySelector('[data-diff="easy"].on'));
    ok(`原型难度「${diff}」：战绩回退为人机`, /（人机）/.test(d.getElementById('recBest').textContent));
    ok(`原型难度「${diff}」：无脚本异常`, errors.length === 0, errors.join(' | '));
    close();
  }
  const { d, close } = boot(undefined, {
    records: JSON.stringify({ ai: { win: [3], lose: true, draw: '2' } }),
  });
  ok('畸形战绩：只接受数字或数字字符串', d.getElementById('recAI').textContent === '0 胜 0 负 2 和');
  close();
}

/* 3) 畸形存档必须被拒绝，且页面仍停在空盘 */
const bad = [
  ['版本号不符', { v: 2, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: 0 }],
  ['空棋谱', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [], acc: 0 }],
  ['非法模式', { v: 1, mode: 'ai-ultra', diff: 'easy', side: 1, moves: [[7, 7]], acc: 0 }],
  ['非法难度', { v: 1, mode: 'pvp', diff: 'godlike', side: 1, moves: [[7, 7]], acc: 0 }],
  ['原型难度', { v: 1, mode: 'pvp', diff: '__proto__', side: 1, moves: [[7, 7]], acc: 0 }],
  ['数组难度', { v: 1, mode: 'pvp', diff: ['easy'], side: 1, moves: [[7, 7]], acc: 0 }],
  ['空计时', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: null }],
  ['空串计时', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: '' }],
  ['空白串计时', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: '   ' }],
  ['数组计时', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: [5] }],
  ['布尔计时', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: true }],
  ['非法执子', { v: 1, mode: 'pvp', diff: 'easy', side: 9, moves: [[7, 7]], acc: 0 }],
  ['坐标多余字段', { v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7, 1]], acc: 0 }],
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

/* 2e) <head> 预初始化脚本：首帧前就拒绝非法配色，且白名单必须与应用层 ACCENTS 保持一致 */
{
  const head = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const app = html.match(/const ACCENTS = \[([^\]]*)\]/)[1].match(/'([a-z]+)'/g).map(x => x.slice(1, -1));
  const pre = head.match(/\[((?:'[a-z]+',?\s*)+)\]\.includes\(a\)/);
  ok('预初始化脚本：含配色白名单', !!pre);
  ok('预初始化脚本：白名单与应用层 ACCENTS 一致',
     !!pre && JSON.stringify(pre[1].match(/'([a-z]+)'/g).map(x => x.slice(1, -1))) === JSON.stringify(app),
     pre && pre[1]);
  const preInit = stored => {
    const dom = new JSDOM('<!DOCTYPE html><html><head><meta name="theme-color" content="#F5F3F8"></head><body></body></html>', {
      url: 'http://localhost/', runScripts: 'outside-only',
      beforeParse(w) { if (stored !== null) w.localStorage.setItem('yimoku:accent', stored); }
    });
    dom.window.eval(head);
    const v = dom.window.document.documentElement.dataset.accent;
    dom.window.close();
    return v;
  };
  for (const a of app) ok(`预初始化脚本：合法配色 ${a} 原样保留`, preInit(a) === a, preInit(a));
  for (const bad of ['not-a-colour', '', 'PURPLE', '__proto__', 'constructor'])
    ok(`预初始化脚本：非法配色「${bad}」回落为紫罗兰`, preInit(bad) === 'purple', preInit(bad));
  ok('预初始化脚本：无偏好时为紫罗兰', preInit(null) === 'purple', preInit(null));
  {
    const dom = new JSDOM('<!DOCTYPE html><html><head><meta name="theme-color" content="#F5F3F8"></head><body></body></html>', {
      url: 'http://localhost/', runScripts: 'outside-only',
      beforeParse(w) {
        Object.defineProperty(w, 'localStorage', { get() { throw new Error('SecurityError'); } });
        w.matchMedia = q => ({ matches: q.includes('dark') });
      }
    });
    dom.window.eval(head);
    const root = dom.window.document.documentElement;
    const meta = dom.window.document.querySelector('meta[name="theme-color"]');
    ok('预初始化脚本：localStorage 抛错时仍跟随系统深色', root.dataset.theme === 'dark', root.dataset.theme);
    ok('预初始化脚本：localStorage 抛错时深色同步 theme-color', meta.getAttribute('content') === '#100D16', meta.getAttribute('content'));
    ok('预初始化脚本：localStorage 抛错时配色回落紫罗兰', root.dataset.accent === 'purple', root.dataset.accent);
    dom.window.close();
  }
}

/* 2f) 撤销到空盘后，上一手标记状态必须同步清空（markLast(-1) 不得残留 prevLast） */
{
  const { w, d, errors, close } = boot({ v: 1, mode: 'pvp', diff: 'easy', side: 1, moves: [[7, 7]], acc: 0 });
  ok('撤销到空盘：恢复时有 1 手且有标记', moveCount(d) === 1 && d.querySelectorAll('.cell.last').length === 1);
  w.eval('undo()');
  ok('撤销到空盘：棋盘为空', moveCount(d) === 0 && stones(d)[0] === 0 && stones(d)[1] === 0);
  ok('撤销到空盘：无「上一手」标记', d.querySelectorAll('.cell.last').length === 0);
  ok('撤销到空盘：prevLast 复位为 -1', w.eval('S.prevLast') === -1, String(w.eval('S.prevLast')));
  clickCell(w, d, 3, 3);
  ok('撤销后再落子：标记落在新一手', d.querySelectorAll('.cell.last').length === 1 &&
     d.querySelector('.cell[data-x="3"][data-y="3"]').classList.contains('last'));
  ok('撤销到空盘：无脚本异常', errors.length === 0, errors.join(' | '));
  close();
}

/* 2g) 读档期间不得把 yimoku:session 临时覆写为 null，也不得为执白存档误排开局 AI */
{
  const writes = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('yimoku:seenHelp', '1');
      w.localStorage.setItem(KEY, JSON.stringify({
        v: 1, mode: 'ai', diff: 'easy', side: 2, moves: [[7, 7]], acc: 3000
      }));
      const origSet = w.Storage.prototype.setItem;
      w.Storage.prototype.setItem = function (k, v) {
        if (k === KEY) writes.push(v);
        return origSet.call(this, k, v);
      };
    }
  });
  ok('执白读档：无脚本异常', errors.length === 0, errors.join(' | '));
  ok('执白读档：恢复 1 手且不把存档临时写成 null',
     moveCount(dom.window.document) === 1 && !writes.includes('null'),
     JSON.stringify(writes));
  dom.window.close();
}

if (failures.length) {
  console.error('session: FAIL');
  for (const f of failures) console.error('  x ' + f);
  process.exit(1);
}
console.log(`session: ${pass} passed, 0 failed`);
