import fs from 'node:fs/promises';

const metadata = `// ==UserScript==
// @name         weibo关注列表定律标签
// @namespace    local.weibo-following-label
// @version      1.0.1
// @author       AndyCycle
// @license      MIT
// @homepageURL  https://github.com/AndyCycle/weibo-following-law-label
// @supportURL   https://github.com/AndyCycle/weibo-following-law-label/issues
// @downloadURL  https://raw.githubusercontent.com/AndyCycle/weibo-following-law-label/main/dist/weibo-following-label.user.js
// @updateURL    https://raw.githubusercontent.com/AndyCycle/weibo-following-law-label/main/dist/weibo-following-label.user.js
// @description  检查页面用户的可见关注列表，命中名单时显示标注与具体博主
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @match        https://s.weibo.com/*
// @match        https://m.weibo.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      weibo.com
// @run-at       document-idle
// @noframes
// ==/UserScript==
`;
await fs.mkdir('dist', { recursive: true });
const core = (await fs.readFile('src/core.mjs', 'utf8')).replace(/^export /gm, '');
const app = await fs.readFile('src/app.js', 'utf8');
const script = `${metadata}\n(async function () {\n'use strict';\n${core}\n${app}\n})();\n`;
await fs.writeFile('dist/weibo-following-label.user.js', script);
const escaped = script.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const installer = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>安装weibo关注列表定律标签</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#243149;font:16px/1.8 system-ui,"Microsoft YaHei",sans-serif}main{max-width:760px;margin:8vh auto;padding:40px;background:white;border:1px solid #e0e5ee;border-radius:20px}h1{font-size:30px;line-height:1.4}p{color:#5b6780}.sample{padding:25px;background:#f8faff;border-radius:10px;margin:28px 0}.badge{font-size:12px;color:#9b4d08;background:#fff1d6;border:1px solid #efcc8a;border-radius:4px;margin-left:7px;padding:2px 6px}button{padding:12px 22px;color:white;background:#315fe8;border:0;border-radius:9px;font:inherit;cursor:pointer}textarea{width:100%;height:300px;margin-top:20px;font:12px/1.6 monospace}.small{font-size:13px}a{color:#315fe8}#status{color:#315fe8}@media(max-width:800px){main{margin:20px;padding:24px}}</style>
<main><div class="small">weibo关注列表定律标签 · 油猴脚本</div><h1>在用户名旁查看关注名单</h1><p>已配置 <b>孤烟暮蝉</b>（UID 2150758415）。脚本查到用户的关注列表包含这位博主后，会在用户名旁显示标注，悬停查看具体博主。</p>
<div class="sample">显示示例：用户名<span class="badge" title="已查到：孤烟暮蝉 · 2150758415">关注列表用户</span></div>
<ol><li>点击下方按钮复制脚本。</li><li>打开 Chrome 工具栏中的油猴 → 添加新脚本。</li><li>全选编辑器原内容，粘贴脚本，按 Ctrl+S 保存。</li><li>刷新已登录的微博页面，在右下角“关注名单”查看进度和编辑名单。</li></ol>
<button id="copy">复制油猴脚本</button> <a href="weibo-following-label.user.js">查看脚本文件</a><p id="status" role="status"></p>
<p class="small">标注会随着逐页检查陆续出现。未显示标注时，可在“关注名单”查看是否仍在检查或读取受限。</p>
<details><summary>查看脚本 / 手动复制</summary><textarea id="source" readonly aria-label="油猴脚本源码">${escaped}</textarea></details>
<p class="small">检查范围以当前微博账号可见的关注列表为准。</p></main>
<script>document.getElementById('copy').addEventListener('click',async()=>{const source=document.getElementById('source');try{await navigator.clipboard.writeText(source.value);document.getElementById('status').textContent='已复制，请粘贴到油猴的新脚本编辑器。'}catch(error){document.querySelector('details').open=true;source.focus();source.select();document.getElementById('status').textContent='浏览器未允许自动复制，脚本已选中，请按 Ctrl+C。'}});</script></html>`;
await fs.writeFile('dist/install.html', installer);
console.log('已生成 dist/weibo-following-label.user.js');
