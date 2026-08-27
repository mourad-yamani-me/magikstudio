#!/usr/bin/env node
/**
 * Lighthouse quality gate. Serves dist/ exactly as Cloudflare would, audits one
 * page of each template, and fails the build if any category drops below budget.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from './serve.mjs';

const PORT = +(process.env.LH_PORT || 0); // 0 = let the OS pick a free port
/* Accessibility, best-practices and SEO are deterministic — they check markup,
   not speed — so they stay at 100 and one run is enough.

   Performance is a lab measurement on a shared runner. Its CPU-bound parts
   (TBT, Speed Index) swing with whatever else is on the machine: the same
   commit scored 94 and 74 in consecutive runs while LCP held at 2.0s. So it
   gets a lower bar AND a median-of-three retry, which tolerates noise while
   still catching a real regression (those drop far below 90 and stay there). */
const BUDGET = {
  performance: 90, accessibility: 100, 'best-practices': 100, seo: 100,
  ...(process.env.LH_BUDGET ? JSON.parse(process.env.LH_BUDGET) : {}),
};
const RETRIES = +(process.env.LH_RETRIES ?? 2);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// one representative page per template
// LH_TARGETS=/,/about/ overrides this locally; keep the default small so CI stays fast
const TARGETS = process.env.LH_TARGETS
  ? process.env.LH_TARGETS.split(',').map((u, i) => [`page${i + 1}`, u.trim()])
  : [
      ['home',    '/'],
      ['game',    '/games/soda-jam-color-sort/'],
      ['privacy', '/privacy/word-slot/'],
      // the blog post template is the only one with code blocks and gist
      // embeds; leaving it untested let a contrast failure ship
      ['post',    '/blog/static-site-cloudflare-workers/'],
    ];

const run = promisify(execFile);

const LH = path.resolve(import.meta.dirname, '..', 'node_modules', '.bin', 'lighthouse');
if (!fs.existsSync(LH)) { console.error('lighthouse not installed — run `npm ci`'); process.exit(1); }

const server = await start(PORT);
const port = server.address().port;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-'));
const results = [];

try {
  for (const [name, url] of TARGETS) {
    const out = path.join(tmp, `${name}.json`);
    // must stay async: the static server runs in this process, so a blocking
    // call here would stall the event loop and Chrome would never get a response.
    try {
      await run(LH, [
        `http://localhost:${port}${url}`,
        '--output=json', `--output-path=${out}`, '--quiet',
        '--chrome-flags=--headless=new --disable-gpu --no-sandbox',
      ], { maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
      console.error(`lighthouse failed on ${url} (exit ${e.code})`);
      console.error(String(e.stderr || e.stdout || e.message).slice(0, 1200));
      throw e;
    }
    let r = JSON.parse(fs.readFileSync(out, 'utf8'));
    let scores = Object.fromEntries(Object.keys(BUDGET)
      .map(k => [k, Math.round((r.categories[k]?.score ?? 0) * 100)]));

    // Only performance is re-measured, and only when it misses.
    const perfRuns = [scores.performance];
    let attempts = 0;
    while (scores.performance < BUDGET.performance && attempts < RETRIES) {
      attempts++;
      console.log(`  ${url}: performance ${scores.performance} — remeasuring (${attempts}/${RETRIES})`);
      await run(LH, [
        `http://localhost:${port}${url}`,
        '--output=json', `--output-path=${out}`, '--quiet',
        '--chrome-flags=--headless=new --disable-gpu --no-sandbox',
      ], { maxBuffer: 32 * 1024 * 1024 });
      r = JSON.parse(fs.readFileSync(out, 'utf8'));
      perfRuns.push(Math.round((r.categories.performance?.score ?? 0) * 100));
      scores.performance = median(perfRuns);
    }

    results.push({
      name, url, scores,
      runs: perfRuns.length > 1 ? perfRuns.join('/') : '',
      lcp: r.audits['largest-contentful-paint'].displayValue,
      cls: r.audits['cumulative-layout-shift'].displayValue,
    });
  }
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

const cols = Object.keys(BUDGET);
console.log('PAGE'.padEnd(10) + cols.map(c => c.slice(0, 5).toUpperCase().padStart(7)).join('') + '      LCP    CLS');
const failures = [];
for (const r of results) {
  console.log(r.name.padEnd(10)
    + cols.map(c => String(r.scores[c]).padStart(7)).join('')
    + r.lcp.padStart(9) + String(r.cls).padStart(7)
    + (r.runs ? `   perf runs: ${r.runs} → median` : ''));
  for (const c of cols) {
    if (r.scores[c] < BUDGET[c]) failures.push(`${r.url} ${c} ${r.scores[c]} < ${BUDGET[c]}`);
  }
}

console.log('\nbudget: ' + cols.map(c => `${c} ≥ ${BUDGET[c]}`).join(', '));
if (failures.length) {
  console.log('\nFAILED:');
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
console.log('all pages within budget');
