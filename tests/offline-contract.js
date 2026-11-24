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
    const attrs = t[2].replace(/\/\s*$/, '');
    for (const a of attrs.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      const attr = a[1].toLowerCase();
      if (!RESOURCE_ATTRS.has(attr)) continue;
      const val = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : a[4]);
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
function cssBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push(m[1]);
  for (const t of text.matchAll(/<[a-zA-Z][\w-]*\b([^>]*)>/g)) {
    const attrs = t[1].replace(/\/\s*$/, '');
    for (const a of attrs.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
      out.push(a[1] !== undefined ? a[1] : (a[2] !== undefined ? a[2] : a[3]));
    }
  }
  return out;
}
function externalCssOf(text) {
  const bad = [];
  const importRe = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)|"([^"]*)"|'([^']*)')/gi;
  for (const raw of cssBlocks(text)) {
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(importRe)) {
      const u = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').trim();
      if (!/^data:/i.test(u)) bad.push(`@import ${u || '(empty)'}`);
    }
    const rest = css.replace(importRe, '');
    for (const m of rest.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi)) {
      const u = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (u && !/^(data:|#)/i.test(u)) bad.push(`url(${u})`);
    }
  }
  return bad;
}
/* 检查器自检：这些写法都会联网，必须全部被认出，避免契约本身失效还照样 PASS */
const probe = externalOf('<img src="data:," srcset="#a 1x, https://x.test/b.png 2x"><video poster="https://x.test/p.jpg">' +
  '<svg><image xlink:href="https://x.test/i.png"/></svg><object data="https://x.test/o.svg">' +
  '<script src=https://x.test/u.js></script><a href="https://x.test/">');
check(probe.length === 5, `检查器漏判联网写法（应为 5 处，实际 ${probe.length}）: ${probe.join(', ')}`);
const cssProbe = externalCssOf('<style>@import "https://x.test/a.css"; @import url("https://x.test/c.css"); ' +
  '.a{background:url(//x.test/b.png)} .b{src:url("Nebulove.woff2")} ' +
  '.ok{background:url("data:image/gif;base64,R0lGODlhAQABAAAAACw=")} .ok2{filter:url(#f)}</style>' +
  '<div style="background:url(bg.png)"></div>');
check(cssProbe.length === 5, `CSS 检查器漏判外部写法（应为 5 处，实际 ${cssProbe.length}）: ${cssProbe.join(', ')}`);
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
const externalCss = externalCssOf(html);
check(externalCss.length === 0, `CSS 中存在非内联资源引用: ${externalCss.join(', ')}`);

if (failures.length) {
  console.error('offline-contract: FAIL');
  for (const f of failures) console.error('  x ' + f);
  process.exit(1);
}
console.log(`offline-contract: PASS (${refs.length} 个 src/href 引用，全部内联)`);
