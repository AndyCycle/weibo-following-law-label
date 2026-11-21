export const DEFAULT_TARGETS = [{ uid: '2150758415', name: '孤烟暮蝉' }];

export function uidFromUrl(input, base = 'https://weibo.com/') {
  let url;
  try { url = new URL(input, base); } catch { return null; }
  if (!['weibo.com', 'www.weibo.com', 's.weibo.com', 'm.weibo.cn'].includes(url.hostname)) return null;
  const path = url.pathname.match(/^\/(?:u\/|profile\/)?(\d{5,20})\/?$/);
  if (path) return path[1];
  const legacy = url.pathname.match(/^\/p\/100505(\d{5,20})\/?$/);
  if (legacy) return legacy[1];
  return null;
}

export function parseTargets(text) {
  const result = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const [value, ...name] = line.trim().split(/[\s,，]+/);
    const uid = /^\d{5,20}$/.test(value) ? value : uidFromUrl(value);
    if (!uid) throw new Error(`第 ${index + 1} 行需要 UID 或微博主页链接`);
    result.set(uid, { uid, name: name.join(' ') || uid });
  }
  if (!result.size) throw new Error('请至少保留一位博主');
  return [...result.values()];
}

export function parsePage(payload) {
  if (Number(payload?.ok) !== 1) {
    const error = new Error(String(payload?.msg || payload?.message || '微博接口返回异常'));
    error.stop = Number(payload?.ok) === -100 || /登录|验证|频繁|访问|权限|login/i.test(error.message);
    throw error;
  }
  const data = payload.data || payload;
  if (!Array.isArray(data.users)) throw new Error('关注列表结构发生变化，缺少 users');
  const users = data.users.map(user => {
    const uid = String(user.idstr || user.id || '');
    if (!/^\d{5,20}$/.test(uid)) throw new Error('关注列表包含无效 UID');
    return { uid, name: String(user.screen_name || uid) };
  });
  const total = data.total_number === undefined ? null : Number(data.total_number);
  if (total !== null && (!Number.isInteger(total) || total < 0)) throw new Error('关注列表总数字段无效');
  const next = data.next_cursor === undefined ? null : String(data.next_cursor);
  if (next !== null && !/^\d+$/.test(next)) throw new Error('关注列表分页字段无效');
  return { users, total, next, filtered: Boolean(Number(data.has_filtered_attentions || 0)) };
}

export function newScan(uid) {
  return { uid, page: 1, pages: 0, seen: new Set(), matches: [], filtered: false, total: null, status: 'pending', reason: '等待检查', checkedAt: null };
}

export function applyPage(state, payload, targets, maxPages = 250, now = Date.now()) {
  const data = parsePage(payload);
  const before = state.seen.size;
  const targetIds = new Set(targets.map(target => target.uid));
  for (const user of data.users) {
    state.seen.add(user.uid);
    if (targetIds.has(user.uid) && !state.matches.some(item => item.uid === user.uid)) state.matches.push(user);
  }
  state.total = data.total;
  state.filtered ||= data.filtered;
  state.pages += 1;
  state.checkedAt = now;
  const allFound = state.matches.length === targets.length;
  const noNew = state.seen.size === before;
  const ended = data.next === '0' || data.users.length === 0 || (data.total !== null && state.seen.size >= data.total);
  const capped = state.pages >= maxPages;
  if (allFound) {
    state.status = 'done';
    state.reason = '名单中的博主均已查到';
  } else if (ended || noNew || capped) {
    const incomplete = state.filtered || (data.total !== null && state.seen.size < data.total) || (!ended && (noNew || capped));
    state.status = incomplete ? 'partial' : 'done';
    state.reason = noNew && data.users.length ? '接口重复返回同一页' : capped && !ended ? '已到单用户分页上限' : incomplete ? '微博仅返回部分可见关注' : '已检查接口返回的可见关注';
  } else {
    state.page += 1;
    state.status = 'pending';
    state.reason = `已检查 ${state.seen.size} 位关注`;
  }
  return state;
}

export function cacheRecord(state) {
  return { uid: state.uid, page: state.page, pages: state.pages, scanned: state.seen.size, matches: state.matches, filtered: state.filtered, total: state.total, status: state.status, reason: state.reason, checkedAt: state.checkedAt };
}

export function cacheFresh(record, now = Date.now()) {
  if (!record || !['done', 'partial'].includes(record.status)) return false;
  const ttl = record.matches.length ? 6 * 3600_000 : 3600_000;
  return now - record.checkedAt >= 0 && now - record.checkedAt < ttl;
}
