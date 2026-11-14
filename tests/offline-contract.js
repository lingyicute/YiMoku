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
   不产生页面加载期的网络请求，因此排除在外。逐个属性解析：旧版每个标签只取
   第一个 src/href，且漏掉 srcset / poster / <object data> / SVG <image> 的
   (xlink:)href 这些同样会在加载期发请求的写法。 */
const RESOURCE_TAGS = new Set(['link', 'script', 'img', 'iframe', 'frame', 'source', 'video', 'audio', 'track',
  'object', 'embed', 'input', 'use', 'image', 'feimage']);
const RESOURCE_ATTRS = new Set(['src', 'href', 'xlink:href', 'srcset', 'imagesrcset', 'poster', 'data']);
function resourceRefs(text) {
  const out = [];
  for (const t of text.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    for (const a of t[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const attr = a[1].toLowerCase();
      if (!RESOURCE_ATTRS.has(attr)) continue;
      const val = a[2] !== undefined ? a[2] : a[3];
      const urls = attr.endsWith('srcset') ? val.split(',').map(s => s.trim().split(/\s+/)[0]) : [val.trim()];
      for (const url of urls) if (url) out.push({ tag: t[1].toLowerCase(), attr, url });
    }
  }
  return out;
}
const externalOf = text => resourceRefs(text)
  .filter(r => RESOURCE_TAGS.has(r.tag))
  .filter(r => !/^(data:|#|blob:)/i.test(r.url))
  .map(r => `<${r.tag} ${r.attr}="${r.url}">`);
/* 检查器自检：这些写法都会联网，必须全部被认出，避免契约本身失效还照样 PASS */
const probe = externalOf('<img src="data:," srcset="#a 1x, https://x.test/b.png 2x"><video poster="https://x.test/p.jpg">' +
  '<svg><image xlink:href="https://x.test/i.png"/></svg><object data="https://x.test/o.svg"><a href="https://x.test/">');
check(probe.length === 4, `检查器漏判联网写法（应为 4 处，实际 ${probe.length}）: ${probe.join(', ')}`);
const refs = resourceRefs(html);
const external = externalOf(html);
check(external.length === 0, `发现外部资源引用: ${external.join(', ')}`);

/* 网络 API：所有内联脚本（含 <head> 预初始化脚本）都不得出现 */
const NET_API = /\bfetch\s*\(|XMLHttpRequest|importScripts|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bimport\s*\(/;
for (const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  check(!NET_API.test(s[1]), '内联脚本包含网络 API 调用');
}
const main = html.match(/<script id="main">([\s\S]*?)<\/script>/);
check(!!main, '缺少 <script id="main">');
if (main) {
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
