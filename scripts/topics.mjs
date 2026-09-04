#!/usr/bin/env node
/**
 * Topic finder — what to write next, and how you will know it worked.
 * Pure Node, no dependencies.
 *
 * The problem this solves is not "think of an article". It is that a post is a
 * day of work with no feedback loop: it ships, it feels fine, and six weeks
 * later nobody can say whether it earned anything. So every subject this script
 * proposes arrives with two things attached — the evidence that somebody
 * actually searches for it, and a falsifiable success condition with a date on
 * it. `--score` comes back later and marks it met or missed.
 *
 * Two sources of evidence, in order of how much they are worth:
 *
 *   1. Search Console — queries this site is ALREADY shown for. This is the
 *      only real demand signal available: Google's own record of what people
 *      typed and where this site landed. Three buckets come out of it, and they
 *      want three different responses (see `bucket()` below).
 *
 *   2. Google Suggest — the autocomplete list, expanded from seeds taken out of
 *      this repo (games, post tags, the stack). It proves a PHRASING is real —
 *      Google does not suggest what nobody types — but it says nothing about
 *      volume. It is the bootstrap source: on a site with four posts and no
 *      history, bucket 1 is empty and this is all there is.
 *
 * A candidate is filtered against what this studio has actually done. A perfect
 * keyword you have not lived produces a post you have to invent, and shape 1 in
 * content/blog/README.md — the one that ranks — needs the real error string,
 * the real version numbers and the false leads. Those cannot be researched.
 *
 * The ledger is content/blog/topics.json. Commit it: the point is the record of
 * what was predicted, not the snapshot of what is currently trending.
 *
 * Environment (same as scripts/seo-ping.mjs — set it once):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service-account key, whole JSON blob.
 *                                Absent -> source 1 is skipped, and so is --score.
 *   GSC_SITE_URL                 Search Console property, default the URL-prefix
 *                                property for the canonical host.
 *
 * Usage:
 *   npm run topics                     discover, rank, merge into the ledger
 *   npm run topics -- --validate       gate them: demand, winnability, indexability, repro
 *   npm run topics -- --score          judge published entries against their targets
 *   npm run topics -- --claim=<id>=<slug>   record that a candidate got written
 *   npm run topics -- --harvest=<id>   build one subject's target block, whatever its status
 *   npm run keywords                   check a draft against what --validate harvested
 *
 * Flags:
 *   --days=N        Search Console window for discovery (default 90)
 *   --limit=N       candidates printed (default 15)
 *   --seed="..."    extra seed, repeatable
 *   --hl=fr         expand suggestions in another language (default en)
 *   --dry-run       print, write nothing
 *   --no-google     skip Search Console
 *   --no-suggest    skip autocomplete expansion
 *   --revalidate    re-query Stack Overflow instead of reusing the cached numbers
 *   --reharvest     rebuild the `seo` target block even where one already exists
 *
 * `--validate` works through the proposed subjects best first, not in file
 * order, so a limited run spends its Stack Exchange quota on what is worth the
 * most. `npm run schedule` prints the same ranking against the free slots.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { coreWords, rank as rankOf } from './topic-seo.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = 'https://www.indiecore.net';
const SCOPE = 'https://www.googleapis.com/auth/webmasters';
const SITE_URL = process.env.GSC_SITE_URL || `${SITE}/`;
const LEDGER = path.join(ROOT, 'content/blog/topics.json');
const BLOG_DIR = path.join(ROOT, 'content/blog');

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const all = name => argv.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));

const DRY = has('--dry-run');
const SCORE_MODE = has('--score');
const CLAIM = opt('claim', '');
const HARVEST = opt('harvest', '');
const DAYS = Number(opt('days', 90)) || 90;
const LIMIT = Number(opt('limit', 15)) || 15;
const HL = opt('hl', 'en');

const summary = [];
const say = line => { console.log(line); summary.push(line); };

const today = () => new Date().toISOString().slice(0, 10);
const ymd = d => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ------------------------------------------------------------------ */
/* the success condition                                               */
/*                                                                     */
/* Four gates, each with a deadline counted from the publish date. They */
/* are deliberately separate: "not indexed" and "indexed but nobody     */
/* searches for it" look identical from the outside and have nothing in */
/* common as problems. Splitting them is the whole value of the check.  */
/*                                                                     */
/* The numbers below are provisional — invented, honestly, because a    */
/* four-day-old site has no baseline. Every --score run appends a       */
/* snapshot to each entry's history, and once three posts have been     */
/* measured at a comparable age the targets switch to the median of     */
/* what this site actually achieves. Then the bar is the site's own.    */

const PROVISIONAL = {
  indexDays: 14,                       // PASS in URL inspection by then
  impressionsDays: 60, impressions: 50, // trailing-28-day impressions
  positionDays: 90, position: 20,       // best average position for any query
  clicksDays: 90, clicks: 5,            // trailing-28-day clicks
};

/** Targets for a post, from this site's own history once there is enough of it. */
function targetsFrom(ledger) {
  const at = (field, day) => {
    const vals = [];
    for (const e of ledger) {
      const snaps = (e.history || []).filter(s => s.age >= day * 0.75 && s.age <= day * 1.5);
      if (snaps.length) vals.push(snaps[snaps.length - 1][field]);
    }
    return vals.length >= 3 ? median(vals) : null;
  };
  const imp = at('impressions', PROVISIONAL.impressionsDays);
  const clk = at('clicks', PROVISIONAL.clicksDays);
  const pos = at('position', PROVISIONAL.positionDays);
  return {
    ...PROVISIONAL,
    impressions: imp === null ? PROVISIONAL.impressions : Math.max(10, Math.round(imp)),
    clicks: clk === null ? PROVISIONAL.clicks : Math.max(1, Math.round(clk)),
    position: pos === null ? PROVISIONAL.position : Math.min(30, Math.round(pos)),
    basis: imp === null ? 'provisional' : 'measured',
  };
}

/* ------------------------------------------------------------------ */
/* what this studio can actually write about                           */

const frontmatter = src => {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[')) v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    else if (v === 'true' || v === 'false') v = v === 'true';
    meta[kv[1]] = v;
  }
  return meta;
};

const posts = fs.readdirSync(BLOG_DIR)
  .filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
  .map(f => ({ slug: f.replace(/\.md$/, ''), ...frontmatter(fs.readFileSync(path.join(BLOG_DIR, f), 'utf8')) }));

/* Seeds, and the fit test, come from the same list: things there is a real
   story about here. Adding a seed is a claim that you have lived it. */
const play = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '_source/play-data.json'), 'utf8')); }
  catch { return {}; }
})();

const SEEDS = [
  'unity android build error',
  'unity gradle build failed',
  'unity il2cpp android',
  'google play policy rejection',
  'google play data safety form',
  'google play privacy policy url',
  'admob unity',
  'admob eea consent',
  // The engine the games are actually built on. The Unity seeds above predate
  // it and stay because the Gradle failures are the same file either way, but
  // everything shipped since runs Capacitor in a WebView, and none of these
  // subjects were reachable while the seed list did not say so.
  'capacitor android build',
  'reduce android app bundle size',
  'r8 minify capacitor android',
  'android app bundle vs apk size',
  'proguard rules capacitor',
  'shrink android apk webp',
  // React Native, added the day a Logo Quiz release went out with R8 off and
  // Play Console grading the bundle "App optimisation: Low". The Capacitor
  // seeds above cover the WebView games; this one game is RN, and its Gradle,
  // Metro and AdMob problems are not the same file.
  'react native android r8 minify release build',
  'play console app optimisation low',
  'admob limited ad serving',
  'how to remove app from admob account',
  'procedural level generation puzzle game',
  'difficulty curve level progression',
  'vite plugin build assets',
  'monorepo multiple mobile games',
  'play games saved games snapshot',
  'cloudflare workers static site',
  'cloudflare workers vs pages',
  'github actions cloudflare deploy',
  'lighthouse largest contentful paint',
  'claude code agents md',
  'ai coding agent code review',
  'search console indexnow',
  'rgpd cnil site web',
  ...Object.values(play).map(p => p.title).filter(Boolean),
  ...all('seed'),
];

/* A candidate has to touch something in here or it is a post you would have to
   invent. Built from the seeds, the tags already used, and the game names. */
const CAPABILITY = new Set([
  ...SEEDS.flatMap(s => s.toLowerCase().split(/\s+/)),
  ...posts.flatMap(p => (Array.isArray(p.tags) ? p.tags : [])).map(t => String(t).toLowerCase()),
  'unity', 'android', 'gradle', 'il2cpp', 'apk', 'aab', 'play', 'admob', 'ads', 'consent',
  'cloudflare', 'workers', 'wrangler', 'github', 'actions', 'lighthouse', 'lcp', 'seo',
  'sitemap', 'indexnow', 'gdpr', 'rgpd', 'cnil', 'privacy', 'claude', 'agent', 'ai',
  'puzzle', 'wordle', 'crossword', 'indie', 'gamedev', 'devlog', 'aso', 'keystore',
  'capacitor', 'webview', 'vite', 'react', 'r8', 'proguard', 'minify', 'shrink', 'dex',
  'webp', 'bundle', 'size', 'monorepo', 'generation', 'procedural', 'difficulty',
  'progression', 'levels', 'firebase', 'crashlytics', 'snapshot',
].map(w => w.replace(/[^a-z0-9]/g, '')));

const STOP = new Set(['the', 'a', 'an', 'to', 'in', 'on', 'for', 'of', 'and', 'or', 'is', 'it',
  'my', 'your', 'how', 'why', 'what', 'when', 'not', 'with', 'without', 'that', 'this', 'do',
  'does', 'can', 'i', 'you', 'vs', 'from', 'at', 'be', 'are']);

const words = s => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
const fits = q => words(q).some(w => CAPABILITY.has(w));

/** Is this already written? Token overlap against every post's title, description and tags. */
function coveredBy(q) {
  const qw = new Set(words(q));
  for (const p of posts) {
    const pw = new Set(words([p.title, p.description, (p.tags || []).join(' ')].join(' ')));
    let hit = 0;
    for (const w of qw) if (pw.has(w)) hit++;
    if (qw.size && hit / qw.size >= 0.6) return p.slug;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* source 2 — Google Suggest                                           */

const MODIFIERS = ['', 'how to ', 'why ', 'fix ', 'best '];
const SUFFIXES = ['', ' error', ' not working', ' fix', ' tutorial', ' vs'];

async function suggest(q) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox`
            + `&hl=${encodeURIComponent(HL)}&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'indiecore-topics' } });
    if (!res.ok) return [];
    const json = JSON.parse(await res.text());
    return Array.isArray(json?.[1]) ? json[1] : [];
  } catch { return []; }
}

const pause = ms => new Promise(r => setTimeout(r, ms));

async function expandSeeds() {
  const found = new Map();          // query -> Set of prefixes that produced it
  let calls = 0;
  for (const seed of [...new Set(SEEDS)]) {
    for (const mod of MODIFIERS) {
      for (const suf of SUFFIXES) {
        if (mod && suf) continue;   // one modifier at a time, or the fan-out explodes
        const prefix = `${mod}${seed}${suf}`;
        const list = await suggest(prefix);
        calls++;
        for (const s of list) {
          const key = s.toLowerCase().trim();
          if (!found.has(key)) found.set(key, new Set());
          found.get(key).add(prefix);
        }
        await pause(120);           // deliberately slow: this is an unofficial endpoint
      }
    }
  }
  say(`- **Suggest** — ${calls} prefixes expanded, ${found.size} distinct queries back`);
  return found;
}

/* ------------------------------------------------------------------ */
/* Google auth — service-account JWT, same shape as seo-ping.mjs        */

const b64url = buf => Buffer.from(buf).toString('base64url');

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.createSign('RSA-SHA256').update(body).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${sig}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

async function searchAnalytics(token, body) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    say(`- **Search Console** — FAILED: HTTP ${res.status} ${detail}`);
    if (res.status === 403) say(`  - the service account is not a user on \`${SITE_URL}\``);
    process.exitCode = 1;
    return null;
  }
  return (await res.json()).rows ?? [];
}

async function inspectUrl(token, url) {
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL, languageCode: 'en-US' }),
  });
  if (!res.ok) {
    if (res.status === 403) say('  - URL inspection needs the service account to be an *owner* of the property');
    return null;
  }
  return (await res.json()).inspectionResult?.indexStatusResult ?? {};
}

const window28 = () => {
  const end = new Date(Date.now() - 2 * 864e5);      // Search Console lags ~2 days
  return { startDate: ymd(new Date(end.getTime() - 27 * 864e5)), endDate: ymd(end) };
};

/* ------------------------------------------------------------------ */
/* source 1 — what the site is already shown for                       */
/*                                                                     */
/* Three buckets, three different jobs. Getting these confused is how a */
/* site ends up with six posts about a query it already ranks fourth    */
/* for, and none about the one it is invisible on.                      */

function bucket(row) {
  if (row.position >= 5 && row.position <= 20 && row.impressions >= 20) return 'near-miss';
  if (row.position > 20 && row.impressions >= 10) return 'stranded';
  if (row.position < 5 && row.ctr < 0.02 && row.impressions >= 20) return 'unclicked';
  return null;
}

const ADVICE = {
  'near-miss': 'already ranks 5–20 — sharpen the title and description of the page that ranks; a new post competes with yourself',
  'stranded': 'real demand, no page that deserves it — this is a post',
  'unclicked': 'ranks well, nobody clicks — the title is the problem, not the coverage',
};

async function fromSearchConsole(token) {
  const end = new Date(Date.now() - 2 * 864e5);
  const start = new Date(end.getTime() - (DAYS - 1) * 864e5);
  const rows = await searchAnalytics(token, {
    startDate: ymd(start), endDate: ymd(end),
    dimensions: ['query', 'page'], rowLimit: 500,
  });
  if (!rows) return [];
  say(`- **Search Console** — ${rows.length} query/page rows over ${DAYS} days`);

  const out = [];
  for (const r of rows) {
    const kind = bucket(r);
    if (!kind) continue;
    out.push({
      query: String(r.keys[0]),
      page: String(r.keys[1]).replace(SITE, '') || '/',
      kind,
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* scoring                                                             */

const PROBLEM = /\b(error|failed|fails|failing|not working|broken|fix|crash|rejected|stuck|won'?t)\b/i;
const HOWTO = /\b(how to|tutorial|guide|setup|step by step|checklist)\b/i;

function shapeOf(q) {
  if (PROBLEM.test(q)) return 'problem';        // shape 1 in content/blog/README.md
  if (/\b(play|store|policy|aso|admob|rejection|listing)\b/i.test(q)) return 'store';
  if (HOWTO.test(q)) return 'howto';
  return 'other';
}

function scoreOf(c) {
  let s = 0;
  const w = words(c.query).length;
  s += Math.min(w, 7) * 5;                       // long tail: winnable by a site with no authority
  if (c.shape === 'problem') s += 25;            // verbatim error strings are how people find you
  if (c.shape === 'store') s += 12;              // hard to find written down, so it ranks
  if (c.shape === 'howto') s += 6;
  s += Math.min(c.seeds?.length || 0, 4) * 6;    // suggested from several prefixes = common phrasing
  if (c.gsc) {
    s += 30;                                     // this site was actually shown for it
    s += Math.min(c.gsc.impressions, 200) / 4;
    if (c.gsc.kind === 'stranded') s += 15;
  }
  if (!fits(c.query)) s -= 45;                   // nothing lived here to write from
  return Math.round(s);
}

/* ------------------------------------------------------------------ */
/* clustering                                                          */
/*                                                                     */
/* Autocomplete returns seventeen spellings of one article. "unity      */
/* gradle build failed", "unity android build error gradle", "unity 6   */
/* gradle build failed" are not seventeen subjects — they are one post  */
/* and its section headings. Collapsing them is what turns a keyword    */
/* dump into a plan, and the variants are worth keeping: each one is a  */
/* phrasing the post should contain verbatim, because that is the       */
/* string somebody pastes into Google.                                  */

const jaccard = (a, b) => {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
};

function cluster(sorted) {
  const heads = [];
  for (const c of sorted) {
    const hit = heads.find(h => jaccard(h.query, c.query) >= 0.45
      || h.query.includes(c.query) || c.query.includes(h.query));
    if (hit) { hit.variants.push(c); if (c.gsc && !hit.gsc) hit.gsc = c.gsc; continue; }
    heads.push({ ...c, variants: [] });
  }
  // a subject people phrase five different ways has five ways in
  for (const h of heads) h.score += Math.min(h.variants.length, 6) * 4;
  return heads.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* the ledger                                                          */

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const readLedger = () => {
  if (!fs.existsSync(LEDGER)) return [];
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); }
  catch (e) { console.error(`${LEDGER} is not valid JSON: ${e.message}`); process.exit(1); }
};

const writeLedger = entries => {
  if (DRY) { say('_dry run — the ledger was not written_'); return; }
  fs.writeFileSync(LEDGER, JSON.stringify(entries, null, 2) + '\n');
};

/* ------------------------------------------------------------------ */
/* discover                                                            */

async function discover() {
  const ledger = readLedger();
  const candidates = new Map();

  const add = (query, extra) => {
    const key = query.toLowerCase().trim();
    if (key.length < 8) return;
    const prev = candidates.get(key) || { query: key, seeds: [], gsc: null };
    candidates.set(key, {
      ...prev, ...extra,
      seeds: [...new Set([...prev.seeds, ...(extra.seeds || [])])],
      gsc: extra.gsc || prev.gsc,
    });
  };

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (has('--no-google')) say('- **Search Console** — skipped (`--no-google`)');
  else if (!raw) say('- **Search Console** — skipped: `GOOGLE_SERVICE_ACCOUNT_JSON` is not set (autocomplete only)');
  else {
    const token = await googleToken(JSON.parse(raw));
    for (const r of await fromSearchConsole(token)) add(r.query, { gsc: r });
  }

  if (has('--no-suggest')) say('- **Suggest** — skipped (`--no-suggest`)');
  else for (const [q, prefixes] of await expandSeeds()) add(q, { seeds: [...prefixes] });

  const known = new Set(ledger.map(e => e.query));
  const scored = [...candidates.values()]
    .map(c => ({ ...c, shape: shapeOf(c.query), covered: coveredBy(c.query) }))
    .map(c => ({ ...c, fits: fits(c.query), score: scoreOf(c) }))
    .filter(c => c.fits)                       // no post you would have to invent
    .sort((a, b) => b.score - a.score);

  const fresh = cluster(scored.filter(c => !c.covered && !known.has(c.query)));

  say('');
  say(`### Subjects — ${fresh.length} distinct, from ${scored.length} queries `
    + `(${scored.length - scored.filter(c => !c.covered && !known.has(c.query)).length} already covered or in the ledger)`);
  say('');
  say('| Score | Subject | Shape | Evidence | Ranking now |');
  say('|--:|---|---|---|---|');
  for (const c of fresh.slice(0, LIMIT)) {
    const ev = c.gsc
      ? `GSC · ${c.gsc.impressions} impr · ${ADVICE[c.gsc.kind].split(' — ')[0]}`
      : `suggest ×${c.seeds.length}${c.variants.length ? ` · ${c.variants.length} phrasings` : ''}`;
    const now = c.gsc ? `\`${c.gsc.page}\` at ${c.gsc.position.toFixed(1)}` : '—';
    say(`| ${c.score} | ${c.query} | ${c.shape} | ${ev} | ${now} |`);
  }

  /* The variants are the deliverable, not trivia: a post that answers the top
     subject should contain each of these strings somewhere, verbatim. */
  const top = fresh.slice(0, 3).filter(c => c.variants.length);
  for (const c of top) {
    say('');
    say(`**\`${c.query}\`** — same post, other phrasings to cover verbatim:`);
    say('');
    for (const v of c.variants.slice(0, 8)) say(`- ${v.query}`);
  }

  const near = scored.filter(c => c.gsc?.kind === 'near-miss');
  if (near.length) {
    say('');
    say(`**Do not write these — fix the page instead.** ${near.length} quer${near.length === 1 ? 'y' : 'ies'} `
      + 'rank 5–20 already; a second post on the same subject competes with the first.');
    say('');
    say('| Query | Page | Position | Impressions |');
    say('|---|---|--:|--:|');
    for (const c of near.slice(0, 10)) {
      say(`| ${c.query} | \`${c.gsc.page}\` | ${c.gsc.position.toFixed(1)} | ${c.gsc.impressions} |`);
    }
  }

  /* merge: new candidates are appended, existing ones keep their status and
     their target — the ledger is a record of predictions, not a scratch file */
  const byQuery = new Map(ledger.map(e => [e.query, e]));
  for (const c of fresh.slice(0, LIMIT)) {
    if (byQuery.has(c.query)) continue;
    byQuery.set(c.query, {
      id: slugify(c.query),
      query: c.query,
      shape: c.shape,
      score: c.score,
      evidence: c.gsc
        ? { source: 'search-console', ...c.gsc }
        : { source: 'suggest', prefixes: c.seeds.slice(0, 6) },
      variants: (c.variants || []).slice(0, 10).map(v => v.query),
      proposed: today(),
      status: 'proposed',
      slug: null,
      published: null,
      target: null,
      history: [],
    });
  }
  const merged = [...byQuery.values()];
  writeLedger(merged);

  say('');
  say(`_${merged.length} entries in \`content/blog/topics.json\`. Pick one, write it, then_ `
    + '`npm run topics -- --claim=<id>=<post-slug>` _to stamp the success condition._');
}

/* ------------------------------------------------------------------ */
/* claim — a candidate became a post                                   */

function claim(spec) {
  const [id, slug] = spec.split('=');
  const ledger = readLedger();
  const entry = ledger.find(e => e.id === id);
  if (!entry) { console.error(`no ledger entry with id "${id}"`); process.exit(1); }

  const file = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) { console.error(`content/blog/${slug}.md does not exist`); process.exit(1); }
  const meta = frontmatter(fs.readFileSync(file, 'utf8'));
  if (meta.draft === true) console.warn(`  warn  ${slug} is still a draft — the clock starts when it ships`);

  const t = targetsFrom(ledger);
  entry.slug = slug;
  entry.published = String(meta.date || today());
  entry.status = 'published';
  entry.target = t;
  writeLedger(ledger);

  const due = n => ymd(new Date(new Date(entry.published).getTime() + n * 864e5));
  say(`### ${entry.id} → /blog/${slug}/`);
  say('');
  say(`Success condition (${t.basis}):`);
  say('');
  say('| Gate | By | Threshold |');
  say('|---|---|---|');
  say(`| Indexed | ${due(t.indexDays)} | URL inspection verdict PASS |`);
  say(`| Impressions | ${due(t.impressionsDays)} | ≥ ${t.impressions} in the trailing 28 days |`);
  say(`| Position | ${due(t.positionDays)} | best query ≤ ${t.position} |`);
  say(`| Clicks | ${due(t.clicksDays)} | ≥ ${t.clicks} in the trailing 28 days |`);
  say('');
  say('_Run_ `npm run topics -- --score` _after each deadline._');
}

/* ------------------------------------------------------------------ */
/* score — did it work?                                                */
/*                                                                     */
/* The diagnosis matters more than the verdict. A post that failed has  */
/* failed in exactly one of four ways, and they have nothing in common: */
/* three of them are cheap to fix and one means the subject was wrong.  */

function diagnose(m, t, age) {
  if (!m.indexed) {
    return age < t.indexDays
      ? ['pending', 'not indexed yet — normal this early']
      : ['missed', 'DISCOVERY: Google has not indexed it. Link it from a related post and the blog index, then `npm run seo`.'];
  }
  if (!m.impressions) {
    return age < t.impressionsDays
      ? ['pending', 'indexed, no impressions yet']
      : ['missed', 'DEMAND: indexed, and nobody searches what it covers. The subject was wrong — retire it, do not rewrite it. Pick a candidate with Search Console evidence next time.'];
  }
  if (m.position > t.position) {
    return age < t.positionDays
      ? ['pending', `ranking ${m.position.toFixed(1)}, still climbing`]
      : ['missed', `COMPETITION: shown ${m.impressions}× but stuck at ${m.position.toFixed(1)}. Go narrower — the exact error string, the version number — or drop the subject.`];
  }
  if (m.clicks < t.clicks) {
    return age < t.clicksDays
      ? ['pending', `position ${m.position.toFixed(1)}, clicks still coming`]
      : ['missed', `TITLE: ranks ${m.position.toFixed(1)} with ${m.impressions} impressions and ${m.clicks} clicks. That is a title and description problem, not a content problem — rewrite them.`];
  }
  return ['met', `${m.clicks} clicks, ${m.impressions} impressions, position ${m.position.toFixed(1)}`];
}

async function scoreLedger() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) { console.error('--score needs GOOGLE_SERVICE_ACCOUNT_JSON — it reads Search Console.'); process.exit(1); }
  const token = await googleToken(JSON.parse(raw));

  const ledger = readLedger();
  const live = ledger.filter(e => e.slug && e.published && e.status !== 'retired');
  if (!live.length) { say('_No published entries in the ledger yet — nothing to score._'); return; }

  const { startDate, endDate } = window28();
  say(`### Scorecard — ${startDate} to ${endDate}`);
  say('');
  say('| Post | Age | Indexed | Clicks | Impr | Pos | Verdict |');
  say('|---|--:|---|--:|--:|--:|---|');

  const notes = [];
  for (const e of live) {
    const url = `${SITE}/blog/${e.slug}/`;
    const age = daysBetween(e.published, today());
    const t = e.target || PROVISIONAL;

    const idx = await inspectUrl(token, url);
    const rows = await searchAnalytics(token, {
      startDate, endDate, dimensions: ['query'], rowLimit: 25,
      dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: url }] }],
    }) || [];

    const m = {
      indexed: idx?.verdict === 'PASS',
      clicks: rows.reduce((a, r) => a + r.clicks, 0),
      impressions: rows.reduce((a, r) => a + r.impressions, 0),
      position: rows.length ? Math.min(...rows.map(r => r.position)) : 99,
      topQuery: rows.sort((a, b) => b.impressions - a.impressions)[0]?.keys?.[0] || null,
    };

    const [verdict, why] = diagnose(m, t, age);
    e.history = [...(e.history || []), { date: today(), age, ...m }];
    if (verdict !== 'pending') e.status = verdict;

    say(`| \`/blog/${e.slug}/\` | ${age}d | ${m.indexed ? 'yes' : 'no'} | ${m.clicks} | `
      + `${m.impressions} | ${m.position === 99 ? '—' : m.position.toFixed(1)} | ${verdict} |`);
    notes.push(`- \`${e.slug}\` — **${verdict}**: ${why}`
      + (m.topQuery ? `\n  - best query: \`${m.topQuery}\`` : ''));
  }

  say('');
  for (const n of notes) say(n);
  writeLedger(ledger);

  const met = ledger.filter(e => e.status === 'met').length;
  if (met >= 3) {
    say('');
    say('_Three posts have met their condition. Their winning queries are in the ledger — '
      + 'the next subject is the one nearest to them, not the one furthest away._');
  }
}

/* ------------------------------------------------------------------ */
/* validation — the gate BEFORE the writing, not after                 */
/*                                                                     */
/* A candidate is a guess until four questions have answers. Three are  */
/* measurable from here; the fourth decides whether the post can be     */
/* written honestly at all.                                            */
/*                                                                     */
/*   demand        does anybody actually have this problem?            */
/*   winnable      is the existing answer old, missing or wrong?       */
/*   indexable     would a page at that URL get found and crawled?     */
/*   reproducible  can this machine reproduce it, or does it need you? */
/*                                                                     */
/* Demand comes from Stack Overflow view counts. They are not keyword  */
/* volume and this script never pretends otherwise: they are the       */
/* number of people who arrived at one page about this exact problem   */
/* and are therefore a FLOOR under the search population, since most   */
/* people who search never open Stack Overflow at all. A floor is      */
/* enough to separate "thousands of people hit this" from "nobody      */
/* does", which is the only distinction that changes what to write.    */

const SE = 'https://api.stackexchange.com/2.3/search/advanced';
const YEAR = 31536000;

async function demandOf(query) {
  const url = `${SE}?order=desc&sort=relevance&q=${encodeURIComponent(query)}`
            + `&site=stackoverflow&pagesize=10`;
  let items = [], quota = null;
  try {
    const res = await fetch(url, { headers: { 'accept-encoding': 'gzip', 'user-agent': 'indiecore-topics' } });
    if (!res.ok) return null;
    const json = await res.json();
    items = json.items || [];
    quota = json.quota_remaining ?? null;
  } catch { return null; }

  const now = Date.now() / 1000;
  let annual = 0, stale = 0, unanswered = 0, rotted = 0;
  for (const q of items) {
    const age = Math.max(0.5, (now - q.creation_date) / YEAR);
    annual += q.view_count / age;
    const isStale = (now - q.last_activity_date) / YEAR > 2;
    if (isStale) stale++;
    if (!q.is_answered) unanswered++;
    if (isStale || !q.is_answered) rotted++;      // one question, one vote
  }
  const top = items.slice().sort((a, b) => b.view_count - a.view_count)[0];
  return {
    questions: items.length,
    /* Kept because they are the harvest, not decoration. Every one of these is
       a sentence a real person typed about this exact problem, already
       downloaded to count views — throwing them away and then going looking for
       "what questions should the post answer" would be paying twice. */
    titles: items.map(q => q.title),
    annualViews: Math.round(annual),
    totalViews: items.reduce((a, q) => a + q.view_count, 0),
    stale, unanswered, rotted,
    top: top ? { title: top.title, views: top.view_count, answered: top.is_answered } : null,
    quota,
    checked: today(),
  };
}

/* Winnability. A question with 100k views and an accepted answer from 2019
   against a Unity version nobody runs is a better target than one with 5k
   views answered last week — the demand is proven and the answer has rotted. */
function winnabilityOf(d, query) {
  if (!d || !d.questions) return { score: 0, why: 'no Stack Overflow questions found — unproven either way' };
  const staleShare = (d.rotted ?? d.stale) / d.questions;   // 0..1 by construction
  const longTail = words(query).length >= 5;
  const score = Math.min(100, Math.round(staleShare * 70 + (longTail ? 30 : 10)));
  const why = staleShare >= 0.5
    ? `${d.stale} of ${d.questions} answers untouched for 2+ years — the answer has rotted`
    : `${d.questions - d.stale} of ${d.questions} recently maintained — a current answer already exists`;
  return { score, why, staleShare: Number(staleShare.toFixed(2)) };
}

/* Indexability. Nothing to do with the subject: it asks whether a page added
   at this URL would be crawlable, listed and linked. Orphan pages are the
   commonest reason a post never indexes, so the linking parent is checked
   explicitly rather than assumed. */
function indexabilityOf(slug, ledger) {
  const DIST = path.join(ROOT, 'dist');
  const notes = [];
  let ok = true;

  if (!fs.existsSync(DIST)) return { ok: false, notes: ['dist/ missing — run `npm run build` first'] };

  const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
  const blocked = /^Disallow:\s*\/blog/mi.test(robots);
  if (blocked) { ok = false; notes.push('robots.txt disallows /blog/'); }
  else notes.push('robots.txt allows /blog/');

  const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
  const blogEntries = (sitemap.match(/\/blog\/[^<]+/g) || []).length;
  if (!blogEntries) { ok = false; notes.push('no /blog/ URLs in sitemap.xml'); }
  else notes.push(`sitemap carries ${blogEntries} blog URLs`);

  const target = path.join(DIST, 'blog', slug, 'index.html');
  if (fs.existsSync(target)) { ok = false; notes.push(`/blog/${slug}/ already exists — pick another slug`); }

  const redirects = path.join(DIST, '_redirects');
  if (fs.existsSync(redirects) && new RegExp(`^/blog/${slug}/?\\s`, 'm').test(fs.readFileSync(redirects, 'utf8'))) {
    ok = false; notes.push(`/blog/${slug}/ is claimed by a redirect`);
  }

  const index = path.join(DIST, 'blog', 'index.html');
  if (fs.existsSync(index)) notes.push('blog index links every post — not orphaned');
  else { ok = false; notes.push('no blog index to link from — the post would be an orphan'); }

  /* the site's own record: does anything here get indexed, and how fast */
  const days = ledger.flatMap(e => (e.history || []).filter(h => h.indexed).map(h => h.age));
  notes.push(days.length
    ? `this site indexes in ~${median(days)} days (${days.length} measurements)`
    : 'no index-time history yet — first --score run will establish it');

  return { ok, notes };
}

/* Reproducibility. "Based on research" is how you write a post that reads like
   every other post about the same error. Reproducing it produces the console
   output, the version numbers and the false leads that make shape 1 rank —
   and this machine turns out to be able to reproduce quite a lot of it. */
const TOOLCHAINS = [
  { match: /\b(unity|gradle|il2cpp|apk|aab|keystore|manifest|proguard)\b/i,
    name: 'Unity Android build',
    probe: () => {
      const hub = '/Applications/Unity/Hub/Editor';
      const editors = fs.existsSync(hub) ? fs.readdirSync(hub) : [];
      const android = editors.filter(v => fs.existsSync(path.join(hub, v, 'PlaybackEngines/AndroidPlayer')));
      const sdk = fs.existsSync(path.join(process.env.HOME, 'Library/Android/sdk'));
      return android.length && sdk
        ? { ok: true, what: `Unity ${android.join(', ')} with the Android module, Android SDK present` }
        : { ok: false, what: editors.length ? 'Unity present but no Android module' : 'no Unity editor found' };
    } },
  { match: /\b(lighthouse|lcp|cls|core web vitals|performance|render)\b/i,
    name: 'Lighthouse run',
    probe: () => ({ ok: fs.existsSync(path.join(ROOT, 'node_modules/lighthouse')),
                    what: 'lighthouse is a devDependency — measurable against a local build' }) },
  { match: /\b(cloudflare|workers|wrangler|github actions|ci|deploy|sitemap|robots|indexnow|search console)\b/i,
    name: 'this site',
    probe: () => ({ ok: true, what: 'reproducible against this repo and its live deploy' }) },
  { match: /\b(claude|agents md|ai|context|prompt)\b/i,
    name: 'this repo',
    probe: () => ({ ok: true, what: 'reproducible here — the workflow is the subject' }) },
  /* Plain `admob`, not just `admob earnings`. "admob limited ad serving" matched
     nothing here and fell through to `unknown`, which means "no reproduction
     path — research only" and now costs a subject 25 rank points. It is a
     console this studio signs into every week, and the post that came out of it
     was written from the real account. A gap in the matcher was reading as a gap
     in the studio. */
  { match: /\b(play console|data safety|policy|rejection|listing|aso|admob)\b/i,
    name: 'your Play Console',
    probe: () => ({ ok: false, what: 'needs your console: the notice text, what you declared, the dates' }) },
];

function reproOf(query) {
  const t = TOOLCHAINS.find(t => t.match.test(query));
  if (!t) return { ok: false, name: 'unknown', what: 'no reproduction path — this would be written from research alone' };
  return { name: t.name, ...t.probe() };
}

/* ------------------------------------------------------------------ */
/* the SEO target block — what the POST has to contain                 */
/*                                                                     */
/* Everything above answers "is this subject worth a day". None of it   */
/* says anything about the article that comes out, and until this       */
/* existed nothing did: content/blog/README.md asked for the variants   */
/* verbatim and no script ever opened a post to check. Three of the     */
/* five published posts hit 7/10, 6/7 and 2/10 against a rule everybody */
/* believed was being followed.                                        */
/*                                                                     */
/* The material is already flowing through this file and being thrown   */
/* away. Autocomplete returns the phrasings; Stack Overflow returns ten */
/* question titles per subject and only the largest was kept. Both are  */
/* sentences real people typed. Nothing is scraped off a result page —  */
/* People Also Ask has no API, blocks runners, and changes shape        */
/* without notice, which is the flaky check AGENTS.md rules out.        */

const QUESTION_PREFIXES = ['how to fix ', 'why does ', 'what causes ', 'how do i ', 'can i '];
const QUESTION_RE = /^(how|why|what|when|where|which|can|does|do|is|are|should|will)\b/i;

/* Autocomplete drifts, and the drift is plausible enough to survive a careless
   filter. Asked about "google play data safety form" it came back with "is
   files by google safe" and "is my data safe with google" — real questions real
   people type, about a different subject entirely. They shared one word with
   the query, and a CAPABILITY test passed them because this repo knows the word
   "google". Requiring most of the SUBJECT's own words is what separates a
   phrasing of this question from a different question nearby. */
/* 0.7, not 0.6. At 0.6 the "google play data safety form" subject harvested
   "is it safe to clear google play store data" and "what happens when i clear
   google play store data" — real questions about clearing a cache, nothing to
   do with the form. Every one of the 20 questions sitting exactly on the 0.6
   floor was that kind of drift, and the distribution has a clean cliff: 80
   questions clear 0.6, 60 clear 0.7, and not one more is lost until 0.8. The
   cost is one good question ("how to create privacy policy url for android
   app") for nineteen bad ones. */
const ON_TOPIC = 0.7;

/* `coreWords` is imported from topic-seo.mjs rather than defined here: the
   checker needs the same answer to decide where the subject must appear, and
   two copies of that judgement would drift. */
const onTopic = (candidate, core) => {
  if (!core.length) return false;
  const got = new Set(words(candidate));
  return core.filter(w => got.has(w)).length / core.length >= ON_TOPIC;
};

/** Autocomplete, asked in question form. Only results that came back as questions count. */
async function askSuggest(query, core) {
  const out = new Set();
  for (const p of QUESTION_PREFIXES) {
    for (const s of await suggest(`${p}${query}`)) {
      const q = String(s).toLowerCase().trim();
      if (QUESTION_RE.test(q) && onTopic(q, core)) out.add(q);
    }
    await pause(120);                 // unofficial endpoint, same courtesy as expandSeeds
  }
  return [...out];
}

/* A Stack Overflow title is a question but rarely a searchable one: it carries
   the asker's version numbers, their file names and their apology. What
   survives that is the shared part, which is the part worth a heading. */
const tidyTitle = t => String(t)
  .replace(/&(quot|#39|amp|lt|gt);/g, ' ')
  .replace(/\s*[[(][^\])]*[\])]\s*/g, ' ')      // "(2019)", "[closed]"
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/* Entities: the content words this subject is actually made of. A word earns a
   place by appearing across at least two independent strings, which is what
   separates the subject's own vocabulary from one asker's variable name. */
function entitiesFrom(strings) {
  const seen = new Map();
  for (const s of strings) for (const w of new Set(words(s))) seen.set(w, (seen.get(w) || 0) + 1);
  return [...seen.entries()]
    .filter(([w, n]) => n >= 2 && w.length > 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

/**
 * Build the block a post is checked against. Additive: an `seo.exempt` already
 * on the entry survives, because it records a decision about a published page
 * and a re-harvest is not a reason to reopen it.
 */
async function harvestSeo(entry, demand) {
  const core = coreWords(entry.query, entry.variants || []);
  const fromSuggest = has('--no-suggest') ? [] : await askSuggest(entry.query, core);
  /* Stack Overflow titles are not tested for a question word. A title on Stack
     Overflow is a question by construction — "Unity Gradle Build failed while
     trying to build project as an APK" is somebody asking why, phrased as a
     statement — and requiring an interrogative threw away every one of them,
     which is how the first two subjects harvested came back with no questions
     at all. Topicality is the test that belongs here; the site already
     guarantees the rest. */
  const fromSO = (demand?.titles || []).map(tidyTitle).filter(t => t && onTopic(t, core));

  /* Deduplicated on content words, not on the string: "how to fix gradle build
     failed in unity" and "how do i fix gradle build failed unity" are one
     heading, and listing both would make the questions target unmeetable by
     construction. */
  /* A heading has to be able to contain every content word, because that is
     what the check asks of it. "error on unity android build - deprecated
     gradle features were used in this build, making it incompatible with gradle
     6.0" is a real question and an impossible target, so the long ones are
     dropped rather than left in to make the gate unmeetable — and the rest are
     offered shortest first, which is also the order they are usable in. */
  /* 12, not 8. The cap was set when a question counted as answered only if one
     heading carried EVERY content word, which made a long question impossible
     by construction. That reasoning was backwards: the cap threw away 46% of
     the on-topic material — including the biggest question on the whole
     subject, "unity gradle build failed while trying to build project as an
     apk" with 29,731 views, and "admob ads fails to load with status details
     limited ad serving". The matcher is what needed fixing (see ANSWER_SHARE in
     topic-seo.mjs); 12 words is where Stack Overflow titles stop being a
     question and start being a stack trace. */
  const HEADING_WORDS = 12;
  /* A bare number is a version fragment: "unity 2022 1 23 gradle build failed"
     asks for a heading containing the token `23`, which nothing will ever
     satisfy. Long words are NOT filtered — `commandinvokationfailure` is 24
     characters and is the actual error string, the best heading target in this
     repo. Length is not the signal; digits are. */
  const unheadable = q => words(q).some(w => /^\d+$/.test(w));

  /* A question identical to the subject is not a question. Six of sixteen
     subjects harvested one, and it was a free pass — the post already has to
     carry the primary verbatim, so making it a heading satisfied the questions
     gate as well without asking anything extra. */
  const primaryFp = [...new Set(words(entry.query))].sort().join(' ');

  const questions = [];
  const fingerprints = new Set();
  const pool = [...fromSuggest, ...fromSO]
    .filter(q => new Set(words(q)).size <= HEADING_WORDS && !unheadable(q))
    .sort((a, b) => words(a).length - words(b).length);
  for (const q of pool) {
    const fp = [...new Set(words(q))].sort().join(' ');
    if (!fp || fp === primaryFp || fingerprints.has(fp)) continue;
    fingerprints.add(fp); questions.push(q);
  }

  const keywords = [...new Set([entry.query, ...(entry.variants || [])])];
  return {
    ...(entry.seo?.exempt ? { exempt: entry.seo.exempt } : {}),
    /* Carried across a re-harvest, like `exempt`. Both record a decision about
       a written post; re-running the harvester is not a reason to reopen one.
       A declined question that no longer appears in the fresh list simply stops
       mattering, which costs nothing. */
    ...(entry.seo?.declined?.length ? { declined: entry.seo.declined } : {}),
    primary: entry.query,
    keywords: keywords.filter(k => k !== entry.query),
    questions: questions.slice(0, 8),
    entities: entitiesFrom([...keywords, ...questions]),
    harvested: today(),
    /* `null`, not 0, when the demand numbers were cached before titles were
       kept: "Stack Overflow offered no questions" and "Stack Overflow was never
       asked" produce the same empty list and are not the same fact. Recording
       the second as a zero would make a subject look harvested when half its
       material was never fetched — and it is the half that comes from real
       people describing the real problem. */
    sources: { suggest: fromSuggest.length, stackoverflow: demand?.titles ? fromSO.length : null },
  };
}

async function validate() {
  const ledger = readLedger();
  const pending = ledger.filter(e => e.status === 'proposed');
  if (!pending.length) { say('_No proposed entries to validate — run `npm run topics` first._'); return; }

  const MIN_ANNUAL = 2000;        // a floor, and a low one: see the note above
  /* Best first, not file order. Stack Exchange allows 300 unauthenticated
     requests a day and autocomplete is an unofficial endpoint asked politely,
     so --limit is a real budget rather than a formality — and spending it on
     whichever subject happened to be written into the ledger first is spending
     it at random. Unvalidated entries have no demand number yet, so this ranks
     on the discovery score, which is the only evidence they have. */
  const targets = [...pending]
    .sort((a, b) => rankOf(b).rank - rankOf(a).rank || (b.score || 0) - (a.score || 0))
    .slice(0, LIMIT);
  say(`Validating ${targets.length} of ${pending.length} proposed subjects.`);
  say('');

  const results = [];
  for (const e of targets) {
    const cached = e.validation && !has('--revalidate') ? e.validation.demand : null;
    const demand = cached || await demandOf(e.query);
    if (!cached) await pause(200);                 // Stack Exchange: 300 requests/day, unauthenticated

    const win = winnabilityOf(demand, e.query);
    const idx = indexabilityOf(slugify(e.query).slice(0, 40), ledger);
    const repro = reproOf(e.query);

    const gscImpr = e.evidence?.source === 'search-console' ? e.evidence.impressions : 0;
    const demandOk = (demand?.annualViews || 0) >= MIN_ANNUAL || gscImpr >= 20;
    /* Zero questions is not zero demand. Stack Overflow covers programming
       problems; it has nothing to say about a Play Console policy screen, a
       coding agent released last year, or a player looking for level answers.
       Calling that NO-GO would quietly kill every subject outside its scope,
       so it is reported as unmeasured and left to a human. */
    const unmeasured = !demand || demand.questions === 0;
    const verdict = unmeasured ? (gscImpr >= 20 ? 'GO' : 'UNMEASURED')
                  : !demandOk ? 'NO-GO'
                  : !idx.ok ? 'BLOCKED' : 'GO';

    e.validation = { date: today(), demand, winnability: win, indexable: idx.ok, repro, verdict };
    /* Harvested only for subjects that cleared the gate. It costs five
       autocomplete calls a subject, and spending them on something already
       rejected for demand is paying an unofficial endpoint to answer a
       question nobody will read. */
    const stale = e.seo && e.seo.sources?.stackoverflow === null && demand?.titles;
    if (verdict === 'GO' && (!e.seo || stale || has('--reharvest'))) e.seo = await harvestSeo(e, demand);
    results.push({ e, demand, win, idx, repro, verdict });
  }

  say('| Verdict | Subject | Readers/yr | Winnable | Indexable | Reproducible here |');
  say('|---|---|--:|--:|---|---|');
  for (const r of results.sort((a, b) => (b.demand?.annualViews || 0) - (a.demand?.annualViews || 0))) {
    say(`| ${r.verdict} | ${r.e.query} | ${r.demand?.annualViews ?? '—'} | ${r.win.score} | `
      + `${r.idx.ok ? 'yes' : 'no'} | ${r.repro.ok ? 'yes — ' + r.repro.name : 'no — ' + r.repro.name} |`);
  }

  const go = results.filter(r => r.verdict === 'GO').sort((a, b) => b.win.score - a.win.score);
  say('');
  say(`### ${go.length} cleared to write`);
  for (const r of go) {
    say('');
    say(`**${r.e.query}**`);
    say(`- demand: ~${r.demand.annualViews} readers a year across ${r.demand.questions} Stack Overflow questions `
      + `(${r.demand.totalViews.toLocaleString('en-US')} views lifetime)`);
    if (r.demand.top) say(`  - biggest: "${r.demand.top.title}" — ${r.demand.top.views.toLocaleString('en-US')} views`);
    say(`- winnable ${r.win.score}/100: ${r.win.why}`);
    say(`- reproducible: ${r.repro.ok ? r.repro.what : 'NO — ' + r.repro.what}`);
    if (r.e.seo) {
      const t = r.e.seo;
      say(`- must contain verbatim: \`${t.primary}\``
        + (t.keywords.length ? `, and ${Math.ceil(t.keywords.length * 0.6)} of ${t.keywords.length} keywords` : ''));
      if (t.questions.length) {
        say(`- questions to answer under a heading (${Math.ceil(t.questions.length * 0.5)} of ${t.questions.length} required):`);
        for (const q of t.questions) say(`  - ${q}`);
      }
      say('- check the draft against it: `npm run keywords -- --topic ' + r.e.id + ' <post-slug>`');
    } else if (r.e.variants?.length) {
      say(`- must contain verbatim: ${r.e.variants.slice(0, 4).map(v => `\`${v}\``).join(', ')}`);
    }
  }

  const nogo = results.filter(r => r.verdict === 'NO-GO');
  if (nogo.length) {
    say('');
    say(`_${nogo.length} rejected: under ${MIN_ANNUAL} readers a year. They stay in the ledger with the `
      + 'number that rejected them, so the same idea does not come back next month._');
  }

  const unk = results.filter(r => r.verdict === 'UNMEASURED');
  if (unk.length) {
    say('');
    say(`**${unk.length} unmeasured** — Stack Overflow has no questions on these, which is a gap in the `
      + 'instrument, not a verdict on the subject. It covers programming problems and knows nothing '
      + 'about Play Console screens, tools released last year, or players hunting level answers:');
    say('');
    for (const r of unk) say(`- ${r.e.query}`);
    say('');
    say('_Publish one deliberately and let `--score` measure it. That is the only instrument that works here._');
  }

  writeLedger(ledger);
}

/* ------------------------------------------------------------------ */
/* harvest one — a subject that is already written                     */
/*                                                                     */
/* `--validate` only looks at proposed subjects, which is right: it is  */
/* the gate before the work. But a post can be written before its       */
/* targets exist — every post here was — and reviewing one of those     */
/* against the new check needs a block for a subject the gate has       */
/* already let through and will never look at again.                   */

async function harvestOne(id) {
  const ledger = readLedger();
  const e = ledger.find(x => x.id === id);
  if (!e) { console.error(`no ledger entry with id "${id}"`); process.exit(1); }

  /* Fetched rather than read from the cache. A subject validated before titles
     were kept has demand numbers and no questions behind them, and harvesting
     off that produces a block whose questions list is empty for a reason that
     has nothing to do with the subject. */
  const demand = e.validation?.demand?.titles && !has('--revalidate')
    ? e.validation.demand
    : await demandOf(e.query);
  if (demand && e.validation) e.validation.demand = demand;

  e.seo = await harvestSeo(e, demand);
  writeLedger(ledger);

  const t = e.seo;
  say(`**${e.query}** → ${e.slug ? `/blog/${e.slug}/` : '(not written yet)'}`);
  say('');
  say(`- primary, verbatim: \`${t.primary}\``);
  if (t.keywords.length) {
    say(`- ${Math.ceil(t.keywords.length * 0.6)} of ${t.keywords.length} keywords, verbatim:`);
    for (const k of t.keywords) say(`  - ${k}`);
  } else {
    say('- no keyword variants: autocomplete offered no other phrasing of this subject');
  }
  if (t.questions.length) {
    say(`- ${Math.ceil(t.questions.length * 0.5)} of ${t.questions.length} questions, under a heading:`);
    for (const q of t.questions) say(`  - ${q}`);
  } else {
    say('- no questions harvested — nothing on Stack Overflow or autocomplete matched closely enough');
  }
  say(`- sources: suggest ${t.sources.suggest}, stackoverflow ${t.sources.stackoverflow ?? 'not asked'}`);
  say('');
  say(e.slug
    ? `_Check the post:_ \`npm run keywords -- --only ${e.slug}\``
    : `_Check a draft:_ \`npm run keywords -- --topic ${e.id} <post-slug>\``);
}

/* ------------------------------------------------------------------ */

say(`### Topics${DRY ? ' (dry run)' : ''} — ${today()}`);
say('');

if (CLAIM) claim(CLAIM);
else if (HARVEST) await harvestOne(HARVEST);
else if (has('--validate')) await validate();
else if (SCORE_MODE) await scoreLedger();
else await discover();

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}
