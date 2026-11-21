import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TARGETS, uidFromUrl, parseTargets, parsePage, newScan, applyPage, cacheRecord, cacheFresh } from '../src/core.mjs';

const target = DEFAULT_TARGETS[0];
const user = (uid, name = uid) => ({ idstr: uid, screen_name: name });
const page = (users, total, next = 0, extra = {}) => ({ ok: 1, users, total_number: total, next_cursor: next, ...extra });

test('profile links resolve to UIDs, while posts and foreign domains are excluded', () => {
  for (const link of [`/u/${target.uid}`, `https://www.weibo.com/${target.uid}`, `https://m.weibo.cn/profile/${target.uid}`, `/p/100505${target.uid}`]) assert.equal(uidFromUrl(link), target.uid);
  for (const link of [`https://evil.example/u/${target.uid}`, `/${target.uid}/RsAAAA`, '/mygroups?gid=123456789', '/sc868448']) assert.equal(uidFromUrl(link), null);
});

test('the configurable list supports links, names, deduplication and actionable input errors', () => {
  assert.deepEqual(parseTargets(`https://weibo.com/u/${target.uid} 孤烟暮蝉\n${target.uid} 最新名称`), [{ uid: target.uid, name: '最新名称' }]);
  assert.throws(() => parseTargets('孤烟暮蝉'), /第 1 行/);
  assert.throws(() => parseTargets(' '), /至少/);
});

test('matches on later pages are found by UID despite changed nicknames', () => {
  const state = newScan('1111111111');
  applyPage(state, page([user('2222222222')], 2, 20), DEFAULT_TARGETS);
  assert.equal(state.status, 'pending'); assert.equal(state.page, 2);
  applyPage(state, page([user(target.uid, '已改名')], 2), DEFAULT_TARGETS);
  assert.equal(state.status, 'done'); assert.deepEqual(state.matches, [{ uid: target.uid, name: '已改名' }]);
});

test('multiple target matches remain pending until all targets or visible pages are checked', () => {
  const targets = [...DEFAULT_TARGETS, { uid: '2222222222', name: '第二位' }];
  const state = newScan('1111111111');
  applyPage(state, page([user(target.uid)], 3, 20), targets);
  assert.equal(state.matches.length, 1); assert.equal(state.status, 'pending');
  applyPage(state, page([user('2222222222')], 3, 40), targets);
  assert.equal(state.matches.length, 2); assert.equal(state.status, 'done');
});

test('empty, truncated, filtered, repeated and capped lists preserve partial status', () => {
  const cases = [page([], 10), page([user('2222222222')], 99), page([user('2222222222')], 1, 0, { has_filtered_attentions: true })];
  for (const payload of cases) { const state = newScan('1111111111'); applyPage(state, payload, DEFAULT_TARGETS); assert.equal(state.status, 'partial'); }
  const repeated = newScan('1111111111');
  applyPage(repeated, page([user('2222222222')], 50, 20), DEFAULT_TARGETS);
  applyPage(repeated, page([user('2222222222')], 50, 40), DEFAULT_TARGETS);
  assert.equal(repeated.status, 'partial'); assert.match(repeated.reason, /重复/);
  const capped = newScan('1111111111'); applyPage(capped, page([user('2222222222')], 50, 20), DEFAULT_TARGETS, 1);
  assert.equal(capped.status, 'partial'); assert.match(capped.reason, /上限/);
  const empty = newScan('1111111111'); applyPage(empty, page([], 0), DEFAULT_TARGETS);
  assert.equal(empty.status, 'done'); assert.equal(empty.matches.length, 0);
});

test('API errors and invalid schemas fail explicitly instead of becoming empty lists', () => {
  assert.throws(() => parsePage({ ok: -100, msg: '请先登录' }), error => error.stop && /登录/.test(error.message));
  assert.throws(() => parsePage({ ok: 1 }), /users/);
  assert.throws(() => parsePage(page([{ screen_name: '无ID' }], 1)), /UID/);
  assert.throws(() => parsePage(page([], -1)), /总数/);
  assert.throws(() => parsePage(page([], 0, 'invalid')), /分页/);
});

test('positive and other caches expire independently; errors and pending scans cannot be cache hits', () => {
  const state = newScan('1111111111'); applyPage(state, page([user(target.uid)], 1), DEFAULT_TARGETS, 250, 1000);
  const positive = cacheRecord(state);
  assert.equal(positive.scanned, 1); assert.equal(cacheFresh(positive, 1000 + 5 * 3600_000), true);
  assert.equal(cacheFresh(positive, 1000 + 6 * 3600_000), false);
  const negative = { ...positive, matches: [] };
  assert.equal(cacheFresh(negative, 1000 + 3600_000), false);
  assert.equal(cacheFresh({ ...positive, status: 'error' }, 2000), false);
  assert.equal(cacheFresh({ ...positive, status: 'pending' }, 2000), false);
});
