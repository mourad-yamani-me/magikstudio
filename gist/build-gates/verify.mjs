#!/usr/bin/env node
/**
 * Build verification — fails the pipeline on anything that would ship broken.
 * Pure Node, no dependencies. Run after `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '..', 'dist');
const SITE = 'https://www.example.com';

const errors = [];
const warnings = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const allFiles = walk(DIST);
const pages = allFiles.filter(f => f.endsWith('.html'));
const rel = f => '/' + path.relative(DIST, f).split(path.sep).join('/');

/** does a site-absolute URL resolve to a real file? */
const resolves = url => {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return fs.existsSync(path.join(DIST, 'index.html'));
  const p = path.join(DIST, clean);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return true;
  return fs.existsSync(path.join(p, 'index.html'));
};

const attr = (html, re) => [...html.matchAll(re)].map(m => m[1]);

for (const file of pages) {
  const where = rel(file);
  const html = fs.readFileSync(file, 'utf8');

  // ---- head essentials ----
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc  = (html.match(/name="description" content="([^"]*)"/) || [])[1] || '';
  const canon = (html.match(/rel="canonical" href="([^"]*)"/) || [])[1] || '';
  const ogimg = (html.match(/property="og:image" content="([^"]*)"/) || [])[1] || '';

  if (!title) fail(where, 'missing <title>');
  else if (title.length > 65) warn(where, `title ${title.length} chars (>65 may truncate)`);
  if (!desc) fail(where, 'missing meta description');
  else if (desc.length > 165) warn(where, `description ${desc.length} chars (>165 may truncate)`);
  if (!canon.startsWith(SITE)) fail(where, `canonical not absolute: "${canon}"`);
  if (!ogimg) fail(where, 'missing og:image');
  else if (!resolves(ogimg.replace(SITE, ''))) fail(where, `og:image missing on disk: ${ogimg}`);

  // ---- structure ----
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) fail(where, `expected exactly 1 <h1>, found ${h1s}`);

  // ---- content hygiene ----
  if (/&amp;(amp|lt|gt|quot|#\d);/.test(html)) fail(where, 'double-escaped HTML entity');
  if (/\[email\s*protected\]/i.test(html))     fail(where, 'unresolved Blogger email placeholder');
  if (/post-body|Obtenir le lien|__wavt/.test(html)) fail(where, 'Blogger markup leaked into output');
  if (/\bTODO\b|\bLOREM\b|lorem ipsum/i.test(html))  fail(where, 'placeholder text left in page');

  // ---- links ----
  for (const href of attr(html, /href="(\/[^"#][^"]*)"/g)) {
    if (!resolves(href)) fail(where, `dead internal link → ${href}`);
  }
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel="[^"]*noopener/.test(m[0])) fail(where, 'target="_blank" without rel="noopener"');
  }

  // ---- images ----
  for (const src of attr(html, /<img[^>]*\ssrc="(\/[^"]+)"/g)) {
    if (!resolves(src)) fail(where, `missing image → ${src}`);
  }
  for (const set of attr(html, /srcset="([^"]+)"/g)) {
    for (const cand of set.split(',')) {
      const u = cand.trim().split(/\s+/)[0];
      if (u.startsWith('/') && !resolves(u)) fail(where, `missing srcset image → ${u}`);
    }
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (/\bhidden\b/.test(m[0])) continue;                    // lightbox slot, intentionally empty
    if (!/\balt=/.test(m[0]))  fail(where, `<img> without alt: ${m[0].slice(0, 70)}`);
    if (!/\bwidth=/.test(m[0])) warn(where, `<img> without width/height (layout shift risk)`);
  }
}

// ---- redirects ----
const redirectsFile = path.join(DIST, '_redirects');
if (!fs.existsSync(redirectsFile)) fail('_redirects', 'missing');
else {
  for (const line of fs.readFileSync(redirectsFile, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [from, to, code] = line.trim().split(/\s+/);
    if (!resolves(to))    fail('_redirects', `${from} → ${to} (target does not exist)`);
    if (code !== '301')   warn('_redirects', `${from} uses ${code}, expected 301`);
  }
}

// ---- sitemap ----
const sitemapFile = path.join(DIST, 'sitemap.xml');
if (!fs.existsSync(sitemapFile)) fail('sitemap.xml', 'missing');
else {
  const sm = fs.readFileSync(sitemapFile, 'utf8');
  const locs = attr(sm, /<loc>([^<]+)<\/loc>/g);
  if (!locs.length) fail('sitemap.xml', 'no <loc> entries');
  for (const loc of locs) {
    if (!loc.startsWith(SITE)) fail('sitemap.xml', `non-canonical host: ${loc}`);
    if (!resolves(loc.replace(SITE, ''))) fail('sitemap.xml', `dead URL: ${loc}`);
  }
  const listed = new Set(locs.map(l => l.replace(SITE, '')));
  for (const p of pages) {
    const url = rel(p).replace(/index\.html$/, '');
    if (url === '/404.html') continue;
    if (!listed.has(url)) warn('sitemap.xml', `page not listed: ${url}`);
  }
}

// ---- required files ----
for (const f of ['robots.txt', 'app-ads.txt', '_headers', '404.html', 'favicon.svg']) {
  if (!fs.existsSync(path.join(DIST, f))) fail('dist', `missing ${f}`);
}

// ---- IndexNow key file ----
// scripts/seo-ping.mjs submits URLs under this key; the crawlers reject the
// submission unless the matching file is live at the site root.
{
  const key = fs.readFileSync(path.join(import.meta.dirname, '..', '_source/indexnow-key.txt'), 'utf8').trim();
  const p = path.join(DIST, `${key}.txt`);
  if (!/^[a-f0-9]{8,128}$/.test(key)) fail('indexnow', `key is not 8-128 hex chars: "${key}"`);
  else if (!fs.existsSync(p)) fail('indexnow', `missing key file /${key}.txt`);
  else if (fs.readFileSync(p, 'utf8').trim() !== key) fail('indexnow', 'key file contents do not match the key');
}

// ---- app-ads.txt (IAB Tech Lab spec) ----
{
  const p = path.join(DIST, "app-ads.txt");
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/)
      .map(l => l.split("#")[0].trim()).filter(Boolean);
    if (!lines.length) fail("app-ads.txt", "no records");
    for (const line of lines) {
      if (/^[A-Z]+=/i.test(line)) continue;           // variable record, e.g. OWNERDOMAIN=
      const f = line.split(",").map(x => x.trim());
      if (f.length < 3 || f.length > 4)
        fail("app-ads.txt", `expected 3-4 fields: ${line}`);
      else if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(f[0]))
        fail("app-ads.txt", `field 1 is not an ad-system domain: ${line}`);
      else if (!/^(DIRECT|RESELLER)$/i.test(f[2]))
        fail("app-ads.txt", `field 3 must be DIRECT or RESELLER: ${line}`);
    }
  }
}

// ---- report ----
console.log(`checked ${pages.length} pages, ${allFiles.length} files\n`);
for (const w of warnings) console.log(`  warn   ${w}`);
if (warnings.length) console.log('');
for (const e of errors) console.log(`  ERROR  ${e}`);

if (errors.length) {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s) — failing build`);
  process.exit(1);
}
console.log(`passed — 0 errors, ${warnings.length} warning(s)`);
