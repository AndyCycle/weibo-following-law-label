import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

const source = await fs.readFile(new URL('../dist/weibo-following-label.user.js', import.meta.url), 'utf8');
const target = { id: 2150758415, screen_name: '孤烟暮蝉' };
const other = { id: 2222222222, screen_name: '同名不命中' };
const payload = (users, total = users.length, next = 0) => ({ ok: 1, users, total_number: total, next_cursor: next });

test('the installer copies the exact distributable script', async () => {
  const html = await fs.readFile(new URL('../dist/install.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:8732/', runScripts: 'dangerously' });
  try {
    let copied;
    dom.window.navigator.clipboard = { writeText: async text => { copied = text; } };
    assert.equal(dom.window.document.getElementById('source').value, source);
    dom.window.document.getElementById('copy').click();
    await sleep(0);
    assert.equal(copied, source);
    assert.match(dom.window.document.getElementById('status').textContent, /已复制/);
  } finally { dom.window.close(); }
});

function setup(t, { html = '<a href="/u/1111111111">测试用户</a>', respond = () => payload([target]), store = {}, slow = false, url = 'https://weibo.com/' } = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [];
  const observed = new Set();
  const visibility = new WeakMap();
  let intersection;
  window.IntersectionObserver = class {
    constructor(callback) { intersection = callback; }
    observe(element) { observed.add(element); visibility.set(element, element.dataset.hidden !== 'true'); queueMicrotask(() => intersection([{ target: element, isIntersecting: visibility.get(element) }])); }
    unobserve(element) { observed.delete(element); }
    disconnect() { observed.clear(); }
  };
  window.GM_getValue = (key, fallback) => store[key] ?? fallback;
  window.GM_setValue = (key, value) => { store[key] = structuredClone(value); };
  window.GM_deleteValue = key => { delete store[key]; };
  window.GM_registerMenuCommand = () => {};
  window.AbortSignal = AbortSignal;
  window.fetch = async url => {
    requests.push({ url: String(url), at: Date.now() });
    const result = await respond(new URL(url), requests.length);
    return { status: result.httpStatus || 200, headers: { get: () => result.contentType || 'application/json' }, text: async () => result.raw ?? JSON.stringify(result) };
  };
  const realTimer = window.setTimeout.bind(window);
  if (!slow) window.setTimeout = (fn, ms, ...args) => realTimer(fn, Math.min(ms, 5), ...args);
  window.eval(source);
  t.after(() => { window.dispatchEvent(new window.Event('pagehide')); window.close(); });
  return { window, requests, store, root: window.document.getElementById('weibo-following-label').shadowRoot, show: element => { visibility.set(element, true); intersection([{ target: element, isIntersecting: true }]); } };
}

async function until(condition, message = 'condition', timeout = 4000) {
  const end = Date.now() + timeout;
  while (!condition()) { if (Date.now() > end) assert.fail(`Timed out: ${message}`); await sleep(10); }
}

test('the distributable script labels names, provides real hover details and deduplicates requests', async t => {
  const app = setup(t, { html: '<a href="/u/1111111111">用户甲</a><a href="/u/1111111111">用户甲</a>' });
  await until(() => app.window.document.querySelectorAll('.wfl-badge').length === 2);
  assert.equal(app.requests.length, 1);
  const badge = app.window.document.querySelector('.wfl-badge');
  assert.equal(badge.textContent, '关注列表用户');
  badge.dispatchEvent(new app.window.MouseEvent('mouseenter'));
  const tip = app.root.getElementById('tip');
  assert.equal(tip.hidden, false); assert.match(tip.textContent, /孤烟暮蝉/); assert.match(tip.textContent, /2150758415/);
  assert.equal(tip.querySelector('a').href, 'https://weibo.com/u/2150758415');
  badge.focus(); assert.equal(tip.hidden, false);
  assert.equal(app.store['wfl-v1:cache:2150758415']['1111111111'].matches[0].uid, '2150758415');
});

test('new comments and reused SPA nodes are checked without keeping a previous user badge', async t => {
  const app = setup(t, { respond: url => payload(url.searchParams.get('uid') === '1111111111' ? [target] : [other]) });
  await until(() => app.window.document.querySelector('.wfl-badge'));
  const link = app.window.document.querySelector('a');
  link.href = '/u/3333333333'; link.textContent = '用户乙';
  await until(() => app.requests.length === 2);
  assert.equal(app.window.document.querySelectorAll('.wfl-badge').length, 0);
  const newLink = app.window.document.createElement('a'); newLink.href = '/u/1111111111'; newLink.textContent = '新评论用户甲'; app.window.document.body.append(newLink);
  await until(() => app.window.document.querySelector('.wfl-badge'));
  assert.equal(app.requests.length, 2);
});

test('pagination is fair between visible users and users outside the viewport wait', async t => {
  const app = setup(t, {
    html: '<a href="/u/1111111111">甲</a><a href="/u/3333333333">乙</a><a href="/u/4444444444" data-hidden="true">屏幕外</a>',
    respond: url => url.searchParams.get('page') === '1' ? payload([other], 2, 20) : payload([target], 2),
  });
  await until(() => app.window.document.querySelectorAll('.wfl-badge').length === 2);
  assert.deepEqual(app.requests.map(item => new URL(item.url).searchParams.get('uid')), ['1111111111', '3333333333', '1111111111', '3333333333']);
  const hidden = app.window.document.querySelector('[data-hidden]'); app.show(hidden);
  await until(() => app.window.document.querySelectorAll('.wfl-badge').length === 3);
});

test('login or risk-control HTML pauses the queue without recording a false no-match', async t => {
  const app = setup(t, { respond: () => ({ raw: '<html>Visitor system</html>', contentType: 'text/html' }) });
  await until(() => /已暂停/.test(app.root.getElementById('toggle').textContent));
  assert.equal(app.window.document.querySelector('.wfl-badge'), null);
  assert.match(app.root.getElementById('status').textContent, /登录或访问校验/);
  assert.equal(app.store['wfl-v1:cache:2150758415'], undefined);
  assert.equal(app.requests.length, 1);
});

test('a partial scan with a real match still labels and explicitly retains the partial status', async t => {
  const app = setup(t, { store: { 'wfl-v1:targets': [{ uid: '2150758415', name: '孤烟暮蝉' }, { uid: '5555555555', name: '第二位' }] }, respond: () => payload([target], 100) });
  await until(() => app.window.document.querySelector('.wfl-badge'));
  assert.match(app.window.document.querySelector('.wfl-badge').title, /仅返回部分/);
  assert.equal(app.store['wfl-v1:cache:2150758415,5555555555']['1111111111'].status, 'partial');
});

test('the existing cache labels immediately with no network call', async t => {
  const app = setup(t, { store: { 'wfl-v1:cache:2150758415': { '1111111111': { uid: '1111111111', pages: 1, page: 1, scanned: 1, matches: [{ uid: '2150758415', name: '孤烟暮蝉' }], status: 'done', total: 1, reason: '名单中的博主均已查到', checkedAt: Date.now() } } } });
  await until(() => app.window.document.querySelector('.wfl-badge'));
  assert.equal(app.requests.length, 0);
});

test('invalid settings show the line number; usernames and matched nicknames remain text', async t => {
  const app = setup(t, { respond: () => payload([{ id: target.id, screen_name: '<img src=x onerror=alert(1)>' }]) });
  await until(() => app.window.document.querySelector('.wfl-badge'));
  app.root.getElementById('toggle').click();
  app.root.getElementById('targets').value = '孤烟暮蝉'; app.root.getElementById('save').click();
  assert.match(app.root.getElementById('error').textContent, /第 1 行/);
  app.window.document.querySelector('.wfl-badge').focus();
  assert.equal(app.root.getElementById('tip').querySelector('img'), null);
  assert.match(app.root.getElementById('tip').textContent, /<img/);
});

test('the request interval is enforced in real time without opening a browser', async t => {
  const app = setup(t, { slow: true, respond: url => url.searchParams.get('page') === '1' ? payload([other], 2, 20) : payload([target], 2) });
  await until(() => app.window.document.querySelector('.wfl-badge'), 'second page', 5000);
  assert.ok(app.requests[1].at - app.requests[0].at >= 1450);
});

test('custom profile paths resolve UID before labelling the profile heading', async t => {
  const app = setup(t, { url: 'https://weibo.com/customname', html: '<h1>用户甲</h1>', respond: url => url.pathname.includes('/profile/info') ? { ok: 1, data: { user: { id: '1111111111' } } } : payload([target]) });
  await until(() => app.window.document.querySelector('.wfl-badge'));
  assert.equal(app.requests.length, 2); assert.match(app.requests[0].url, /custom=customname/);
  assert.equal(app.window.document.querySelector('h1').nextElementSibling.className, 'wfl-badge');
});
