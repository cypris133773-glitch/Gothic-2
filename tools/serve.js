// A static file server, because ES modules need http:// and opening index.html
// off disk will not work. No dependencies, no build step, no watcher yet — the
// hot-reload path arrives with the content registry (§11.2).
//
//   npm start          → http://localhost:8090
//   PORT=9000 npm start

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8090;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';

  // Resolve inside ROOT and refuse anything that escapes it. A dev server is
  // still a server, and this one gets pointed at a laptop's home directory.
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      // Never cache during development: a stale module is an hour of confusion.
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`GRIMWARD dev server  →  http://localhost:${PORT}`);
});
