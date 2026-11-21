import http from 'node:http';
import fs from 'node:fs/promises';

const files = new Map([
  ['/', ['install.html', 'text/html; charset=utf-8']],
  ['/install.html', ['install.html', 'text/html; charset=utf-8']],
  ['/weibo-following-label.user.js', ['weibo-following-label.user.js', 'text/javascript; charset=utf-8']],
]);
const server = http.createServer(async (request, response) => {
  const file = files.get(new URL(request.url, 'http://127.0.0.1').pathname);
  if (request.method !== 'GET' || !file) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const body = await fs.readFile(new URL(`../dist/${file[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }); response.end(body);
  } catch (error) { console.error(error.message); response.writeHead(500); response.end('Failed to read installer'); }
});
server.listen(8732, '127.0.0.1', () => console.log('安装页面：http://127.0.0.1:8732/（Ctrl+C 停止）'));
