const STORE = 'wfl-v1';
let targets = GM_getValue(`${STORE}:targets`, DEFAULT_TARGETS);
const fingerprint = targets.map(item => item.uid).sort().join(',');
let cache = GM_getValue(`${STORE}:cache:${fingerprint}`, {});
let paused = GM_getValue(`${STORE}:paused`, false);
let requests = 0;
let budget = 300;
let busy = false;
let stopped = '';
let cursor = 0;
let lastRequest = 0;
let destroyed = false;
let profile = { url: '', uid: null };
const tasks = new Map();
const nodes = new Map();
const bindings = new WeakMap();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const delayMs = 1500;
const rootHost = document.createElement('div');
rootHost.id = 'weibo-following-label';
const shadow = rootHost.attachShadow({ mode: 'open' });
shadow.innerHTML = `<style>
  :host { all:initial; font:13px/1.6 system-ui,"Microsoft YaHei",sans-serif; color:#243149; }
  * { box-sizing:border-box; } button,textarea { font:inherit; }
  button { cursor:pointer; border:1px solid #d6dce6; border-radius:7px; background:#fff; color:#243149; padding:5px 10px; }
  button:hover { background:#f0f5ff; } .primary { background:#315fe8; color:white; border-color:#315fe8; }
  #toggle { position:fixed; right:20px; bottom:24px; z-index:2147483645; box-shadow:0 3px 18px #15244925; }
  #panel { position:fixed; right:20px; bottom:70px; width:360px; max-width:calc(100vw - 32px); max-height:75vh; overflow:auto; z-index:2147483646; background:#fff; border:1px solid #dce2eb; border-radius:12px; box-shadow:0 10px 40px #15244930; padding:18px; }
  [hidden] { display:none!important; } h2 { font-size:17px; margin:0 0 9px; } p { margin:8px 0; } .muted { color:#657188; font-size:12px; }
  .actions { display:flex; gap:7px; flex-wrap:wrap; margin:10px 0; } textarea { width:100%; height:100px; padding:8px; border:1px solid #c9d1df; border-radius:6px; resize:vertical; color:#243149; background:white; }
  #status { color:#3c5487; } #error { color:#b42318; white-space:pre-wrap; } #results { max-height:220px; overflow:auto; margin-top:12px; }
  .row { border-top:1px solid #edf0f5; padding:7px 0; } .row a, #tip a { color:#315fe8; text-decoration:none; } .row small { display:block; color:#657188; }
  #tip { position:fixed; z-index:2147483647; max-width:min(340px,90vw); max-height:55vh; overflow:auto; padding:12px 15px; background:#17243b; color:#fff; border-radius:9px; box-shadow:0 5px 20px #0003; white-space:normal; }
  #tip a { color:#b7d5ff; display:block; margin:4px 0; } #tip .muted { color:#c6cfdd; } #tip strong { display:block; margin-bottom:5px; }
</style>
<button id="toggle" type="button" aria-expanded="false">关注名单 · 准备中</button>
<section id="panel" hidden aria-label="微博关注名单设置">
  <h2>weibo关注列表定律标签</h2>
  <p class="muted">用户名旁的“关注列表用户”表示已查到关注关系，悬停可查看命中的博主。</p>
  <p id="status" role="status"></p>
  <div class="actions"><button id="pause" type="button"></button><button id="refresh" type="button">清除缓存并重查</button></div>
  <label for="targets">匹配名单：每行一个 UID 或主页链接，可在后面填写昵称</label>
  <textarea id="targets" spellcheck="false" aria-label="匹配博主名单"></textarea>
  <div class="actions"><button id="save" class="primary" type="button">保存名单</button><button id="close" type="button">收起</button></div>
  <p id="error" role="alert"></p>
  <p class="muted">只检查进入屏幕的用户名，每次读取间隔至少 1.5 秒。未完成、读取受限或未查到匹配均不显示命中标注。缓存：命中 6 小时，其他结果 1 小时。</p>
  <div id="results"></div>
</section>
<div id="tip" role="tooltip" hidden></div>`;
document.documentElement.append(rootHost);
const $ = id => shadow.getElementById(id);
$('targets').value = targets.map(item => `${item.uid} ${item.name}`).join('\n');
const globalStyle = document.createElement('style');
globalStyle.textContent = `.wfl-badge{display:inline-block!important;vertical-align:middle!important;position:relative!important;font:11px/1.6 system-ui,"Microsoft YaHei",sans-serif!important;font-weight:500!important;color:#9b4d08!important;background:#fff1d6!important;border:1px solid #efcc8a!important;border-radius:4px!important;padding:0 5px!important;margin:0 0 0 5px!important;white-space:nowrap!important;cursor:help!important;letter-spacing:0!important;text-decoration:none!important}.wfl-badge:focus{outline:2px solid #315fe8!important}`;
document.documentElement.append(globalStyle);

function scanned(state) { return state.seen ? state.seen.size : state.scanned; }
function summary(state) {
  const count = scanned(state);
  const names = state.matches.map(item => item.name).join('、');
  const info = state.status === 'pending' ? `检查中，已读取 ${count} 位关注` : state.reason;
  return `${names ? `已查到：${names}；` : ''}${info}（${count}${state.total === null ? '' : '/' + state.total}）`;
}

function updatePanel() {
  const results = [...tasks.values()];
  const finished = results.filter(item => item.status !== 'pending').length;
  const hits = results.filter(item => item.matches.length).length;
  const status = stopped || (paused ? '已暂停' : requests >= budget ? '已达到本轮请求限额，点击继续检查' : busy ? '正在检查屏幕中的用户' : '等待屏幕中待检查的用户');
  $('toggle').textContent = `关注名单 · ${hits} 人命中${paused || stopped || requests >= budget ? ' · 已暂停' : ''}`;
  $('status').textContent = `${status}。已完成 ${finished}/${results.length} 人，本轮 ${requests} 次读取。`;
  $('pause').textContent = paused || stopped || requests >= budget ? '继续检查' : '暂停检查';
  if ($('panel').hidden) return;
  const fragment = document.createDocumentFragment();
  for (const state of results.slice(-80).reverse()) {
    const row = document.createElement('div'); row.className = 'row';
    const link = document.createElement('a'); link.href = `https://weibo.com/u/${state.uid}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = state.name || state.uid;
    const detail = document.createElement('small'); detail.textContent = summary(state);
    row.append(link, detail); fragment.append(row);
  }
  $('results').replaceChildren(fragment);
}

function togglePanel(open = $('panel').hidden) {
  $('panel').hidden = !open;
  $('toggle').setAttribute('aria-expanded', String(open));
  updatePanel();
}
$('toggle').addEventListener('click', () => togglePanel());
$('close').addEventListener('click', () => togglePanel(false));
$('pause').addEventListener('click', () => {
  if (stopped || requests >= budget) { stopped = ''; budget = requests + 300; paused = false; }
  else paused = !paused;
  GM_setValue(`${STORE}:paused`, paused);
  updatePanel(); void pump();
});
$('save').addEventListener('click', () => {
  try {
    const parsed = parseTargets($('targets').value);
    GM_setValue(`${STORE}:targets`, parsed);
    location.reload();
  } catch (error) { $('error').textContent = error.message; }
});
$('refresh').addEventListener('click', () => {
  GM_deleteValue(`${STORE}:cache:${fingerprint}`);
  location.reload();
});
GM_registerMenuCommand('编辑关注名单 / 查看检查状态', () => togglePanel(true));

let tipTimer;
function hideTip() { tipTimer = setTimeout(() => { $('tip').hidden = true; }, 180); }
function showTip(badge, state) {
  clearTimeout(tipTimer);
  const tip = $('tip'); tip.replaceChildren();
  const heading = document.createElement('strong'); heading.textContent = '关注列表中已查到'; tip.append(heading);
  for (const match of state.matches) {
    const link = document.createElement('a'); link.textContent = `${match.name} · ${match.uid}`; link.href = `https://weibo.com/u/${match.uid}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; tip.append(link);
  }
  const info = document.createElement('p'); info.className = 'muted';
  info.textContent = `${state.reason}。检查时间：${state.checkedAt ? new Date(state.checkedAt).toLocaleString('zh-CN') : '检查中'}。`;
  tip.append(info); tip.hidden = false;
  const rect = badge.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - tip.offsetWidth - 8))}px`;
  tip.style.top = `${rect.bottom + tip.offsetHeight + 12 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - tip.offsetHeight - 6)}px`;
}
$('tip').addEventListener('mouseenter', () => clearTimeout(tipTimer));
$('tip').addEventListener('mouseleave', hideTip);
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('tip').hidden = true; });
window.addEventListener('scroll', () => { $('tip').hidden = true; }, { passive: true });

function paint(element, state) {
  const binding = bindings.get(element);
  if (!binding || binding.uid !== state.uid) return;
  if (!state.matches.length) { binding.badge?.remove(); binding.badge = null; return; }
  let badge = binding.badge;
  if (!badge?.isConnected) {
    badge = document.createElement('span'); badge.className = 'wfl-badge'; badge.textContent = '关注列表用户'; badge.tabIndex = 0;
    badge.setAttribute('aria-label', '关注列表用户，查看匹配博主');
    element.after(badge); binding.badge = badge;
    badge.addEventListener('mouseenter', () => showTip(badge, tasks.get(binding.uid)));
    badge.addEventListener('mouseleave', hideTip);
    badge.addEventListener('focus', () => showTip(badge, tasks.get(binding.uid)));
    badge.addEventListener('blur', hideTip);
    badge.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); showTip(badge, tasks.get(binding.uid)); });
  }
  badge.title = summary(state);
}

function paintUser(uid) {
  const state = tasks.get(uid);
  for (const element of nodes.get(uid) || []) {
    if (!element.isConnected) { nodes.get(uid).delete(element); continue; }
    paint(element, state);
  }
}

const visible = new WeakSet();
const viewport = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
    const uid = bindings.get(entry.target)?.uid;
    if (entry.isIntersecting && uid && !tasks.has(uid)) {
      const saved = cache[uid];
      const state = cacheFresh(saved) ? { ...saved } : newScan(uid);
      state.name = entry.target.textContent.trim(); tasks.set(uid, state); paintUser(uid);
    }
  }
  updatePanel(); void pump();
}, { rootMargin: '0px' });

function bind(element, uid) {
  const previous = bindings.get(element);
  if (previous?.uid === uid) {
    if (tasks.has(uid)) paint(element, tasks.get(uid));
    return;
  }
  if (previous) { previous.badge?.remove(); nodes.get(previous.uid)?.delete(element); viewport.unobserve(element); }
  bindings.set(element, { uid, badge: null });
  if (!nodes.has(uid)) nodes.set(uid, new Set());
  nodes.get(uid).add(element); viewport.observe(element);
  if (tasks.has(uid)) paint(element, tasks.get(uid));
}

function discover() {
  for (const link of document.querySelectorAll('a[href]')) {
    const uid = uidFromUrl(link.getAttribute('href'), location.href);
    const text = link.textContent.trim();
    if (uid && text && text.length <= 80 && !link.querySelector('button')) bind(link, uid);
    else if (bindings.has(link)) {
      const old = bindings.get(link); old.badge?.remove(); nodes.get(old.uid)?.delete(link); bindings.delete(link); viewport.unobserve(link);
    }
  }
  const profileUid = profile.url === location.href ? profile.uid : uidFromUrl(location.href);
  for (const heading of document.querySelectorAll('h1,[class*="ProfileHeader_name_"]')) {
    if (profileUid && heading.textContent.trim() && !heading.closest('a')) bind(heading, profileUid);
    else if (bindings.has(heading)) {
      const old = bindings.get(heading); old.badge?.remove(); nodes.get(old.uid)?.delete(heading); bindings.delete(heading); viewport.unobserve(heading);
    }
  }
  for (const [uid, elements] of nodes) {
    for (const element of elements) if (!element.isConnected) { viewport.unobserve(element); elements.delete(element); }
    if (!elements.size) nodes.delete(uid);
  }
  if (profile.url !== location.href) void resolveProfile();
}

async function resolveProfile() {
  const url = location.href;
  profile = { url, uid: uidFromUrl(url) };
  // Custom profile URLs are resolved only when the page actually has a profile heading.
  const heading = document.querySelector('h1,[class*="ProfileHeader_name_"]');
  const custom = location.pathname.match(/^\/([A-Za-z][A-Za-z0-9_]*)\/?$/)?.[1];
  if (profile.uid || !custom || !['weibo.com', 'www.weibo.com'].includes(location.hostname)) return;
  if (!heading) { profile.url = ''; return; }
  try {
    const payload = await requestJson(`https://weibo.com/ajax/profile/info?custom=${encodeURIComponent(custom)}`);
    if (Number(payload.ok) !== 1 || !payload.data?.user) throw new Error('自定义主页 UID 读取失败');
    if (location.href !== url) return;
    profile.uid = String(payload.data.user.idstr || payload.data.user.id);
    discover();
  } catch (error) { $('error').textContent = error.message; }
}
let discoverTimer;
const observer = new MutationObserver(records => {
  if (records.every(record => record.target === globalStyle || record.target === rootHost || record.target.closest?.('.wfl-badge'))) return;
  clearTimeout(discoverTimer); discoverTimer = setTimeout(discover, 200);
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'], characterData: true });

async function requestJson(url) {
  let status, text, contentType;
  if (location.hostname === 'weibo.com') {
    const response = await fetch(url, { credentials: 'include', headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' }, signal: AbortSignal.timeout(20000) });
    status = response.status; text = await response.text(); contentType = response.headers.get('content-type') || '';
  } else {
    const response = await new Promise((resolve, reject) => GM_xmlhttpRequest({ method: 'GET', url, headers: { accept: 'application/json' }, timeout: 20000, onload: resolve, onerror: () => reject(new Error('跨域读取失败，请确认油猴已允许连接 weibo.com')), ontimeout: () => reject(new Error('微博请求超时')) }));
    status = response.status; text = response.responseText; contentType = response.responseHeaders || '';
  }
  if ([401, 403, 418, 429, 432].includes(status) || /text\/html/i.test(contentType) || /^\s*</.test(text)) {
    const error = new Error(`微博要求登录或访问校验（HTTP ${status}），完成验证后点击继续检查`); error.stop = true; throw error;
  }
  if (status !== 200) throw new Error(`微博读取失败：HTTP ${status}`);
  return JSON.parse(text);
}

async function requestPage(uid, page) {
  return requestJson(`https://weibo.com/ajax/friendships/friends?uid=${uid}&page=${page}`);
}

function nextTask(advance = false) {
  const list = [...tasks.values()];
  for (let offset = 0; offset < list.length; offset++) {
    const index = (cursor + offset) % list.length;
    const state = list[index];
    if (state.status === 'pending' && [...(nodes.get(state.uid) || [])].some(node => node.isConnected && visible.has(node))) {
      if (advance) cursor = (index + 1) % list.length;
      return state;
    }
  }
  return null;
}

function persist(state) {
  cache[state.uid] = cacheRecord(state);
  const recent = Object.entries(cache).sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 500);
  cache = Object.fromEntries(recent);
  GM_setValue(`${STORE}:cache:${fingerprint}`, cache);
}

async function pump() {
  if (busy || paused || stopped || destroyed) return;
  busy = true;
  try {
    while (!paused && !stopped && !destroyed && requests < budget) {
      if (document.hidden || !nextTask()) break;
      await sleep(Math.max(0, lastRequest + delayMs - Date.now()));
      if (paused || stopped || destroyed || document.hidden) break;
      const state = nextTask(true);
      if (!state) break;
      lastRequest = Date.now(); requests++; updatePanel();
      try {
        const payload = await requestPage(state.uid, state.page);
        applyPage(state, payload, targets);
        if (state.status !== 'pending') persist(state);
      } catch (error) {
        if (error.stop) { stopped = error.message; state.reason = '等待完成微博登录或访问校验'; }
        else { state.status = 'error'; state.reason = error.message; }
      }
      paintUser(state.uid); updatePanel();
    }
  } finally { busy = false; updatePanel(); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { discover(); void pump(); } });
window.addEventListener('pagehide', () => { destroyed = true; observer.disconnect(); viewport.disconnect(); });
discover(); updatePanel();
