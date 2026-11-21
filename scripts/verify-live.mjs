import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_TARGETS, newScan, applyPage, cacheRecord } from '../src/core.mjs';

const [cookieFile, uid] = process.argv.slice(2);
if (!cookieFile || !/^\d{5,20}$/.test(uid || '')) throw new Error('用法：node scripts/verify-live.mjs <Cookie文件路径> <样本用户UID>');
const cookie = (await fs.readFile(cookieFile, 'utf8')).trim();
const headers = { cookie, accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', referer: 'https://weibo.com/', 'x-requested-with': 'XMLHttpRequest' };
async function request(path) {
  const response = await fetch(new URL(path, 'https://weibo.com'), { headers, signal: AbortSignal.timeout(20000) });
  if (response.status !== 200) throw new Error(`微博 HTTP ${response.status}`);
  const body = await response.json();
  if (Number(body.ok) !== 1) throw new Error(`微博接口读取失败：${body.msg || body.message}`);
  return body;
}
const profile = await request(`/ajax/profile/info?uid=${DEFAULT_TARGETS[0].uid}`);
await sleep(1500);
const state = newScan(uid);
const firstPage = await request(`/ajax/friendships/friends?uid=${uid}&page=1`);
applyPage(state, firstPage, DEFAULT_TARGETS);
const result = { verifiedAt: new Date().toISOString(), method: 'Authenticated HTTP; no browser launched', target: { uid: String(profile.data.user.id), name: profile.data.user.screen_name }, result: cacheRecord(state) };
await fs.mkdir('verification', { recursive: true });
await fs.writeFile('verification/live-result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!state.matches.length) process.exitCode = 1;
