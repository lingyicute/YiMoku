#!/usr/bin/env node
/* YiMoku — 引擎自检运行器（零依赖，克隆后即可运行）
 *
 * 从 index.html 抽取内嵌主脚本，拼上开发专用的 tests/selftest-core.js 断言体，
 * 再在 Node 作用域里执行 selfTest()：
 *   - 横/竖/斜五连判定与四连不判胜
 *   - 棋型评估（活四/死四/活三/跳四/FIVE）
 *   - 威胁计数去重、叶子终局判定（cond1/cond2）的符号与分值约定
 *   - 双活三识别、双威胁加权系数与叶子准胜负判定
 *   - ↗ 方向所有五格窗口覆盖、右下半区活四的威胁与静态评分
 *   - TW[0] = 0（被包围空点评分不得为 NaN）
 *   - 各难度的必胜手 / 必挡手
 *   - 一盘完整的模拟对局
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
const m = html.match(/<script id="main">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('FAIL: index.html 中未找到 <script id="main">');
  process.exit(1);
}
const core = fs.readFileSync(path.join(__dirname, 'selftest-core.js'), 'utf-8');
if (!/function\s+selfTest\s*\(/.test(core)) {
  console.error('FAIL: tests/selftest-core.js 中未找到 selfTest()');
  process.exit(1);
}

try {
  // 无 document/window：主脚本入口不会调用 init()，只由我们显式触发自检。
  new Function(m[1] + '\n' + core + '\nselfTest();\n')();
  console.log('tests/selftest.js: PASS');
} catch (e) {
  console.error('FAIL:', (e && e.stack) || e);
  process.exit(1);
}
