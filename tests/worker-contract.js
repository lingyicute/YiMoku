#!/usr/bin/env node
/* YiMoku — Worker 自举契约测试（零依赖）
 * 验证产品 HTML 中 ENGINE_START/ENGINE_END 圈出的代码段确实是「纯引擎」：
 * 不含 DOM/存储引用，能在无 window/document 的作用域里求值，并能像真实
 * Worker 一样响应 chooseMove 消息返回合法着点。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script id="main">([\s\S]*?)<\/script>/);
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

check(!!m, '缺少 <script id="main">');
if (!m) { report(); }
const src = m[1];
const a = src.indexOf('/*ENGINE_START*/'), b = src.indexOf('/*ENGINE_END*/');
check(a >= 0 && b > a, 'ENGINE_START / ENGINE_END 缺失或顺序错误');

if (a >= 0 && b > a) {
  const engine = src.slice(a, b);
  check(/function\s+chooseAiMove\s*\(/.test(engine), '引擎段缺少 chooseAiMove');
  check(!/document\.|window\.|localStorage|navigator\./.test(engine),
        '引擎段混入了浏览器专属 API（Worker 中会抛错）');
  check(!/function\s+init\s*\(/.test(engine), '引擎段混入了应用层 init()');

  const wrapper = engine + '\n' +
    'self.onmessage = function(e) {\n' +
    '  var d = e.data;\n' +
    '  if (d && d.type === "chooseMove") {\n' +
    '    var mv = chooseAiMove(d.board, d.diff, d.aiP);\n' +
    '    self.postMessage({ id: d.id, mv: mv });\n' +
    '  }\n' +
    '};\n';
  let self = { postMessage: () => {} }, reply = null;
  try {
    // 故意不注入 window/document，模拟真实 Worker 全局环境
    new Function('self', wrapper)(self);
    check(typeof self.onmessage === 'function', 'Worker 未注册 onmessage');
    const board = new Uint8Array(225);
    board[7 * 15 + 7] = 1;                       // 天元已有黑子，白方需要应手
    self.postMessage = msg => { reply = msg; };
    self.onmessage({ data: { id: 7, type: 'chooseMove', board: board, diff: 'hard', aiP: 2 } });
    check(reply && reply.id === 7, 'Worker 未回复或回复 id 不匹配');
    check(reply && reply.mv && Number.isInteger(reply.mv.x) && Number.isInteger(reply.mv.y),
          'Worker 返回的着点格式非法');
    check(reply && reply.mv && board[reply.mv.y * 15 + reply.mv.x] === 0,
          'Worker 返回了非空点');
  } catch (e) {
    check(false, '引擎段求值/通信抛错: ' + (e && e.message));
  }
}
report();

function report() {
  if (failures.length) {
    console.error('worker-contract: FAIL');
    for (const f of failures) console.error('  x ' + f);
    process.exit(1);
  }
  console.log('worker-contract: PASS');
}
