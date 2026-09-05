#!/usr/bin/env node
/**
 * Static server that mirrors Cloudflare Pages behaviour: brotli/gzip,
 * the Cache-Control rules from dist/_headers, _redirects, and the 404 page.
 * Used for local preview and as the target for the Lighthouse gate.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve(import.meta.dirname, '..', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.xml', '.txt', '.json']);

function loadRedirects() {
  const f = path.join(DIST, '_redirects');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const [from, to, code] = l.split(/\s+/); return { from, to, code: +code || 301 }; });
}

function cacheControl(urlPath) {
  if (urlPath.startsWith('/assets/games/') || urlPath.startsWith('/assets/fonts/'))
    return 'public, max-age=31536000, immutable';
  if (urlPath.startsWith('/assets/og/')) return 'public, max-age=604800';
  if (urlPath.startsWith('/assets/'))    return 'public, max-age=86400';
  return 'public, max-age=600';
}

export function start(port = 4321) {
  const redirects = loadRedirects();
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    const hit = redirects.find(r => r.from === urlPath);
    if (hit) { res.writeHead(hit.code, { Location: hit.to }); return res.end(); }

    let file = path.join(DIST, urlPath);
    if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('Forbidden'); }

    let status = 200;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const asDir = path.join(file, 'index.html');
      if (fs.existsSync(asDir)) file = asDir;
      else { file = path.join(DIST, '404.html'); status = 404; }
    }

    const ext = path.extname(file);
    let body = fs.readFileSync(file);
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl(urlPath),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    const accept = req.headers['accept-encoding'] || '';
    if (COMPRESSIBLE.has(ext) && /\bbr\b/.test(accept)) {
      body = zlib.brotliCompressSync(body); headers['Content-Encoding'] = 'br';
    } else if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(accept)) {
      body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  /* A port already in use throws an unhandled 'error' event, which Node prints
     as a stack trace ending in EADDRINUSE — technically accurate and useless at
     the moment you hit it, because it does not say which port or what to do.
     Anything else on the machine holding 4321 breaks `npm run dev` this way. */
  return new Promise((resolve, reject) => {
    server.once('error', err => {
      if (err.code !== 'EADDRINUSE') return reject(err);
      console.error(
        `\n  port ${port} is already in use — something else on this machine is holding it.\n\n` +
        `  see what:   lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
        `  or move:    PORT=${port + 1} npm run dev\n`);
      process.exit(1);
    });
    server.listen(port, () => resolve(server));
  });
}

if (import.meta.filename === process.argv[1]) {
  const port = +(process.env.PORT || process.argv[2] || 4321);
  if (!fs.existsSync(DIST)) { console.error('dist/ not found — run `npm run build` first.'); process.exit(1); }
  await start(port);
  console.log(`serving dist/ on http://localhost:${port}`);
}
