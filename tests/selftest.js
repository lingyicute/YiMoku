#!/usr/bin/env node
/* YiMoku — 内置自检运行器（零依赖，克隆后即可运行）
 *
 * 从 index.html 抽取内嵌主脚本并在 Node 中执行其自带的 selfTest()：
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

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const m = html.match(/<script id="main">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('FAIL: index.html 中未找到 <script id="main">');
  process.exit(1);
}

try {
  // document/window 不存在 → 脚本入口自动走 Node 分支执行 selfTest()
  // selfTest 内部断言失败会自行 process.exit(1)
  new Function(m[1])();
  console.log('tests/selftest.js: PASS');
} catch (e) {
  console.error('FAIL:', (e && e.stack) || e);
  process.exit(1);
}
