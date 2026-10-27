#!/usr/bin/env node
/* YiMoku — 离线契约检查（零依赖）
 * 保证交付的单个 HTML 文件：
 *   1. 没有任何会发起网络请求的 src/href（data: 与 # 锚点除外）；
 *   2. 主脚本不引用 fetch / XMLHttpRequest / importScripts / 外部字体 CDN；
 *   3. 引擎标记 ENGINE_START/ENGINE_END 存在且顺序正确（Worker 自举依赖它）；
 *   4. 产品文件不含开发专用自检代码（应位于 tests/selftest-core.js）；
 *   5. 存在内联 favicon，阻止 /favicon.ico 回退请求。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/* 只检查会由浏览器自动加载的资源属性；<a href> 是用户点击后的导航，
   不产生页面加载期的网络请求，因此排除在外。 */
const refs = [...html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["'][^>]*>/g)]
  .map(m => ({ tag: m[1].toLowerCase(), attr: m[2].toLowerCase(), url: m[3] }));
const RESOURCE_TAGS = new Set(['link', 'script', 'img', 'iframe', 'source', 'video', 'audio', 'object', 'embed', 'use']);
const external = refs
  .filter(r => RESOURCE_TAGS.has(r.tag))
  .filter(r => !/^(data:|#|blob:)/i.test(r.url))
  .map(r => `<${r.tag} ${r.attr}="${r.url}">`);
check(external.length === 0, `发现外部资源引用: ${external.join(', ')}`);

const main = html.match(/<script id="main">([\s\S]*?)<\/script>/);
check(!!main, '缺少 <script id="main">');
if (main) {
  check(!/\bfetch\s*\(|XMLHttpRequest|importScripts/.test(main[1]),
        '主脚本包含网络 API 调用');
  const a = main[1].indexOf('/*ENGINE_START*/');
  const b = main[1].indexOf('/*ENGINE_END*/');
  check(a >= 0 && b > a, '引擎标记 ENGINE_START / ENGINE_END 缺失或顺序错误');
}

check(!/function\s+selfTest\s*\(/.test(html), '产品 HTML 混入了开发专用自检代码');
check(/<link\s+rel=["']icon["']/i.test(html), '缺少内联 favicon（浏览器会请求 /favicon.ico）');
check(!/@import\s+url\(\s*["']?https?:/i.test(html), 'CSS 中存在远程 @import');
check(!/url\(\s*["']?https?:/i.test(html), 'CSS 中存在远程 url() 资源');

if (failures.length) {
  console.error('offline-contract: FAIL');
  for (const f of failures) console.error('  x ' + f);
  process.exit(1);
}
console.log(`offline-contract: PASS (${refs.length} 个 src/href 引用，全部内联)`);
