#!/usr/bin/env node
/**
 * Search Console watcher — what changed since last time, and what to do about it.
 * Pure Node, no dependencies.
 *
 * `scripts/seo-ping.mjs` answers "what does Google think of the site right now".
 * That question is worth asking, but its answer is worthless the moment the run
 * ends: nothing is kept, so the two states that matter most — a page that USED
 * to be indexed and is not any more, a query that USED to rank on page one —
 * are invisible. A regression only exists relative to a previous observation.
 *
 * So this keeps one. The ledger is _source/seo-watch.json, and it is committed
 * for the same reason content/blog/topics.json is: the record of what was
 * observed is the product, not the snapshot of what happens to be true today.
 * No database, no external store — a JSON file in the repo, diffable in review.
 *
 * Each run does three things:
 *
 *   1. Observe   — index status per sitemap URL, search performance per page
 *                  and per query, and the sitemap's own health.
 *   2. Compare   — against the previous run, and open a finding for anything
 *                  that got worse or that was already worth acting on.
 *   3. Close     — a finding whose condition no longer holds closes itself,
 *                  with the date. Nothing accumulates that is not still true.
 *
 * Findings are the point. Each one names a URL or a query, says what is wrong,
 * and implies a specific fix — a title rewrite, an internal link, a post. They
 * carry stable ids so a re-run updates rather than duplicates, and so a human
 * or an agent can close one by id once the work is done.
 *
 * Deliberately NOT here: anything that edits the site. This observes and
 * records; the fixing happens in a branch, in a pull request, like every other
 * change. See docs/seo-automation.md.
 *
 * Both engines are watched. Google answers through Search Console, Bing through
 * the Webmaster Tools API, and each writes into its own half of the ledger — a
 * page can be indexed by one and invisible to the other, which is a fact worth
 * seeing rather than averaging away. Either credential alone is enough to run.
 *
 * Environment (same as scripts/seo-ping.mjs — set it once):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service-account key, whole JSON blob.
 *   GSC_SITE_URL                 Search Console property, default the URL-prefix
 *                                property for the canonical host.
 *   BING_API_KEY                 Bing Webmaster Tools -> Settings -> API access.
 *                                Absent -> the Bing half is skipped.
 *
 * Usage:
 *   npm run seo:watch                    observe, compare, update the ledger
 *   npm run seo:watch -- --brief         just the open findings, as a work list
 *   npm run seo:watch -- --dry-run       observe and report, write nothing
 *   npm run seo:watch -- --close=<id>    mark a finding fixed
 *   npm run seo:watch -- --wontfix=<id>  close it as not worth fixing
 *
 * Flags:
 *   --days=N        search-performance window (default 28)
 *   --no-inspect    skip per-URL index inspection (the slow part)
 *   --note="..."    reason, recorded alongside --close / --wontfix
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as bing from './bing-api.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = 'https://www.indiecore.net';
const HOST = new URL(SITE).host;
const SITEMAP = `${SITE}/sitemap.xml`;
const SCOPE = 'https://www.googleapis.com/auth/webmasters';
const SITE_URL = process.env.GSC_SITE_URL || `${SITE}/`;
const LEDGER = path.join(ROOT, '_source/seo-watch.json');

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const opt = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DRY = has('--dry-run');
const BRIEF = has('--brief');
const NO_INSPECT = has('--no-inspect');
const DAYS = Number(opt('days', 28)) || 28;
const CLOSE = opt('close', '');
const WONTFIX = opt('wontfix', '');
const NOTE = opt('note', '');
// Bing throttles per-URL lookups hard (ErrorCode 5, "ThrottleHost") and the block
// outlasts a CI run, so a pass over the whole sitemap returns nothing for most of
// it. Measured against the live API rather than guessed: exactly ten calls
// succeed and the eleventh is refused, and spacing them three seconds apart does
// not raise that — it is a budget per window, not a rate. Slowing down further
// buys nothing, so ten is the default and the run stops when Bing says stop.
//
// Check a rotating slice instead and let the ledger accumulate what one run
// cannot. Index membership shifts over weeks, so revisiting a URL every few days
// samples it far more often than it actually changes.
const BING_URL_BUDGET = Number(opt('bing-urls', 10)) || 10;
const BING_GAP_MS = 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const today = () => new Date().toISOString().slice(0, 10);
const ymd = d => d.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

const summary = [];
const say = line => { console.log(line); summary.push(line); };

/* ------------------------------------------------------------------ */
/* the ledger                                                          */

// `bing` is a parallel half rather than extra fields on `urls`: the two engines
// answer different questions, on different schedules, and either can be absent
// from a run. Keeping them apart means a missing Bing key cannot look like a
// Google regression, and an old ledger reads correctly with no migration.
const EMPTY = {
  site: SITE_URL, updated: null, runs: 0, urls: {}, queries: {},
  bing: { site: null, urls: {}, queries: {} },
  findings: [],
};

const readLedger = () => {
  if (!fs.existsSync(LEDGER)) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(LEDGER, 'utf8')) };
  } catch (e) {
    console.error(`${LEDGER} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
};

const writeLedger = l => {
  if (DRY) { say('_dry run — the ledger was not written_'); return; }
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + '\n');
};

/* ------------------------------------------------------------------ */
/* Google auth — service-account JWT exchanged for an access token      */

const b64url = buf => Buffer.from(buf).toString('base64url');

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email, scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  };
  const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.createSign('RSA-SHA256').update(body).sign(sa.private_key).toString('base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${body}.${sig}`,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

/** Any Search Console call. Returns null and explains itself on failure. */
async function gsc(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.ok) return res.json();

  const detail = (await res.text()).slice(0, 300);
  say(`- **Search Console** — FAILED: HTTP ${res.status} ${detail}`);
  if (res.status === 403) {
    say(`  - the service account is not an owner of \`${SITE_URL}\` `
      + '(URL inspection needs Owner, not Full — see docs/seo-automation.md)');
  }
  process.exitCode = 1;
  return null;
}

/* ------------------------------------------------------------------ */
/* preflight — is this property actually readable?                      */
/*                                                                      */
/* Without this, a service account that has not been added to the       */
/* property returns 403 on the first call and on every later one, which */
/* reads as four unrelated failures rather than the one missing click   */
/* in Search Console that it is. Ask once, up front, and name the fix.  */
/* It also catches the Domain vs URL-prefix mismatch by reporting what  */
/* the account CAN see, which is otherwise an identical-looking 403.    */

async function preflight(token, sa) {
  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`could not list Search Console properties: HTTP ${res.status}`);
    console.error(JSON.stringify(json).slice(0, 300));
    process.exit(1);
  }

  const entries = json.siteEntry ?? [];
  if (!entries.length) {
    console.error('This service account can see no Search Console properties.\n');
    console.error('  Add it in Search Console → Settings → Users and permissions → Add user:');
    console.error(`    ${sa.client_email}`);
    console.error('  Permission: Owner. Full is not enough — URL inspection returns 403 on it.\n');
    console.error('  docs/seo-automation.md has the walkthrough.');
    process.exit(1);
  }

  const match = entries.find(e => e.siteUrl === SITE_URL);
  if (!match) {
    console.error(`This service account cannot see \`${SITE_URL}\`, but it can see:\n`);
    for (const e of entries) console.error(`    ${e.siteUrl}  (${e.permissionLevel})`);
    console.error('\n  If the property you want is listed above, point GSC_SITE_URL at it —');
    console.error('  a Domain property is `sc-domain:indiecore.net`, not a URL. Otherwise add');
    console.error(`  ${sa.client_email} to it as Owner.`);
    process.exit(1);
  }

  // Full is enough to submit a sitemap and read performance, but not to inspect
  // a URL. Say so now rather than letting the index table silently not render.
  if (match.permissionLevel !== 'siteOwner' && !NO_INSPECT) {
    say(`- **Index status** — skipped: permission is \`${match.permissionLevel}\`, and URL `
      + 'inspection needs `siteOwner`. Everything else still runs.');
    return { ...match, canInspect: false };
  }
  return { ...match, canInspect: true };
}

/* ------------------------------------------------------------------ */
/* observe                                                             */

async function liveUrls() {
  const res = await fetch(SITEMAP, { headers: { 'user-agent': 'indiecore-seo-watch' } });
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  if (!urls.length) throw new Error('sitemap contained no <loc> entries');
  return urls;
}

/* Each inspection takes Google the better part of seven seconds, and a
   sequential pass over two dozen URLs is minutes of billed wall-clock for a job
   that is almost entirely waiting. The quota is 600 queries per minute per
   property, so a handful at a time is nowhere near it — and it keeps the run
   inside the CI timeout as the sitemap grows, which sequential would not. */
const INSPECT_CONCURRENCY = 5;

async function inspectAll(token, urls) {
  const out = {};
  const queue = [...urls];
  let failed = false;

  const worker = async () => {
    while (queue.length && !failed) {
      const u = queue.shift();
      const json = await gsc(token, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST',
        body: JSON.stringify({ inspectionUrl: u, siteUrl: SITE_URL, languageCode: 'en-US' }),
      });
      if (!json) { failed = true; return; }   // a 403 fails every other call too
      const r = json.inspectionResult?.indexStatusResult ?? {};
      out[u] = {
        verdict: r.verdict ?? 'UNKNOWN',
        coverage: r.coverageState ?? null,
        crawled: r.lastCrawlTime ? r.lastCrawlTime.slice(0, 10) : null,
      };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(INSPECT_CONCURRENCY, urls.length) }, worker));
  return failed ? null : out;
}

async function performance(token) {
  const end = new Date(Date.now() - 2 * 864e5);          // Search Console lags ~2 days
  const start = new Date(end.getTime() - (DAYS - 1) * 864e5);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;

  const query = async (dimension, rowLimit) => {
    const json = await gsc(token, url, {
      method: 'POST',
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions: [dimension], rowLimit }),
    });
    return json?.rows ?? null;
  };

  const [pages, queries] = await Promise.all([query('page', 200), query('query', 500)]);
  return pages && queries ? { pages, queries, start: ymd(start), end: ymd(end) } : null;
}

async function sitemapHealth(token) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}`
            + `/sitemaps/${encodeURIComponent(SITEMAP)}`;
  return gsc(token, url);
}

/* ------------------------------------------------------------------ */
/* observe — Bing                                                      */
/*                                                                     */
/* Bing has no equivalent of Google's inspection verdict. GetUrlInfo    */
/* returns a record for a URL it has crawled and nothing at all for one */
/* it has not, so "Bing knows this page" is an inference from a crawl   */
/* date, not a claim Bing makes. The findings below are worded to match */
/* what the data actually supports — a report that overstates its       */
/* evidence is worse than one that admits the gap.                      */

/** Weekly buckets, all of history, no date parameters — so the window is cut
 *  here. Position is averaged across weeks weighted by each week's
 *  impressions; a flat mean would let a quiet week count as much as a busy one. */
function bingQueryWindow(rows) {
  const cutoff = ymd(new Date(Date.now() - DAYS * 864e5));
  const acc = new Map();
  for (const r of rows) {
    const d = bing.msDate(r.Date);
    if (!d || d < cutoff) continue;
    const q = String(r.Query ?? '').trim();
    if (!q) continue;
    const a = acc.get(q) ?? { clicks: 0, impressions: 0, weighted: 0 };
    const imp = Number(r.Impressions) || 0;
    a.clicks += Number(r.Clicks) || 0;
    a.impressions += imp;
    a.weighted += (Number(r.AvgImpressionPosition) || 0) * imp;
    acc.set(q, a);
  }
  return [...acc].map(([query, a]) => ({
    query, clicks: a.clicks, impressions: a.impressions,
    position: a.impressions ? Number((a.weighted / a.impressions).toFixed(1)) : 0,
  }));
}

async function bingObserve(urls, prev) {
  if (!bing.bingKey()) {
    say('- **Bing** — skipped: `BING_API_KEY` is not set');
    return null;
  }

  const resolved = await bing.resolveSite(HOST);
  if (!resolved.ok) {
    say(`- **Bing** — skipped: ${resolved.error}`);
    return null;
  }

  const site = resolved.site.url;
  if (!resolved.canonical) {
    say(`- **Bing** — WARNING: no property covering \`${HOST}\`, reading \`${site}\` instead. `
      + 'That is a different domain, so nothing below describes this site. Add '
      + `\`${SITE}/\` in Bing Webmaster Tools.`);
  }

  // Longest-unchecked first, so every URL comes round rather than the same ten
  // being re-read while the tail is never looked at.
  const slice = [...urls]
    .sort((a, b) => (prev.bing?.urls?.[a]?.checked ?? '')
      .localeCompare(prev.bing?.urls?.[b]?.checked ?? ''))
    .slice(0, BING_URL_BUDGET);

  const index = {};
  let throttled = false;
  let failures = 0;

  // Sequential and spaced. Concurrency here does not finish sooner — it trips
  // the throttle on the second call and loses the rest of the run with it.
  for (const u of slice) {
    const res = await bing.getUrlInfo(site, u);
    if (!res.ok) {
      // Once throttled, every further call fails too. Stop rather than spend
      // the run proving it, and leave the untouched URLs for tomorrow.
      if (/throttle/i.test(res.error ?? '')) { throttled = true; break; }
      failures++;
      continue;
    }
    index[u] = {
      crawled: bing.msDate(res.data?.LastCrawledDate),
      discovered: bing.msDate(res.data?.DiscoveryDate),
      http: res.data?.HttpStatus ?? null,
    };
    await sleep(BING_GAP_MS);
  }

  const done = Object.keys(index).length;
  if (!done) {
    // Nothing readable. Returning null keeps every Bing finding untouched,
    // rather than reading silence as "Bing knows none of these pages" and
    // opening one for all of them.
    say(`- **Bing** — URL lookups returned nothing this run`
      + (throttled ? ' (throttled by Bing — it will pick up where it left off)' : ''));
    return null;
  }
  say(`- **Bing** — checked ${done} of ${urls.length} URLs this run`
    + (throttled ? ', then Bing throttled; the rest roll over to tomorrow' : '')
    + (failures ? `, ${failures} failed` : ''));

  const issuesRes = await bing.getCrawlIssues(site);
  const statsRes = await bing.getQueryStats(site);

  return {
    site,
    index,
    issues: issuesRes.ok ? (issuesRes.data ?? []) : null,
    queries: statsRes.ok ? bingQueryWindow(statsRes.data ?? []) : null,
  };
}

/* ------------------------------------------------------------------ */
/* findings                                                            */
/*                                                                     */
/* One rule per thing that has a distinct fix. A finding that cannot be */
/* acted on differently from its neighbour is noise, and noise is what  */
/* makes a report stop being read. Each carries a stable id so re-runs  */
/* update rather than duplicate, and closes itself when it stops being  */
/* true — see AGENTS.md, "How to add a check".                          */

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const short = u => u.replace(SITE, '') || '/';

/** Google gives a reason for not indexing a crawled page, and each one has its
 *  own fix. Reading the reason is the difference between acting and guessing. */
function notIndexedFix(coverage = '') {
  const c = coverage.toLowerCase();
  if (c.includes('duplicate') || c.includes('canonical')) {
    return 'Google picked a different canonical. Check rel=canonical on the page '
         + 'and whether another URL serves the same content.';
  }
  if (c.includes('noindex')) {
    return 'The page asks not to be indexed. If that is wrong, remove the noindex '
         + 'and request indexing; scripts/verify.mjs should probably grow a check.';
  }
  if (c.includes('redirect')) {
    return 'The sitemap lists a URL that redirects. List the destination instead.';
  }
  if (c.includes('crawled')) {
    return 'Google fetched it and chose not to index it, which is a quality or '
         + 'duplication judgement rather than a technical fault. Thin or templated '
         + 'pages get this. Internal links from pages that do rank help.';
  }
  return 'Open the Pages report in Search Console for the reason behind this state.';
}

/** Thresholds, named so the report can explain itself rather than assert. */
const T = {
  staleCrawlDays: 90,     // indexed, but Google has not looked in three months
  neverCrawledDays: 14,   // in the sitemap this long and still never fetched
  slipPositions: 3,       // a real move, not day-to-day jitter
  slipImpressions: 20,    // ...on a query with enough volume to mean something
  nearMissLow: 5,         // ranking below this is already page one
  nearMissHigh: 21,       // above this, a title rewrite will not bridge the gap
  zeroClickImpressions: 50,
};

/** Which findings each source is able to produce. A source that did not run
 *  proves nothing, so its findings must not be closed for lack of evidence. */
const KINDS = {
  index:   ['deindexed', 'never-crawled', 'not-indexed', 'stale-crawl'],
  sitemap: ['sitemap-errors', 'sitemap-warnings'],
  perf:    ['position-slip', 'near-miss', 'zero-click'],
  bing:    ['bing-coverage', 'bing-not-indexed', 'bing-crawl-issue'],
};

function detect({ index, perf, sitemap, bingObs, bingState, prev }) {
  const found = [];
  const firstRun = !(prev.runs > 0);
  // A gate decides whether a finding is worth OPENING. It must never decide
  // whether one stays open: a problem that is still true has not gone away
  // because a grace period has not elapsed again.
  const alreadyOpen = id => prev.findings.some(f => f.id === id && f.status === 'open');
  const add = (kind, subject, detail, fix) =>
    found.push({ id: `${kind}:${slug(subject)}`, kind, subject, detail, fix });

  /* --- index coverage -------------------------------------------- */
  if (index) {
    for (const [url, now] of Object.entries(index)) {
      const was = prev.urls[url];
      const key = short(url);

      if (was && was.verdict === 'PASS' && now.verdict !== 'PASS') {
        add('deindexed', key,
          `was indexed on ${was.seen}, now reports ${now.verdict}${now.coverage ? ` (${now.coverage})` : ''}`,
          'Check the page still returns 200, is in the sitemap, and is not noindex. '
          + 'Then request indexing in Search Console by hand.');
      } else if (now.verdict !== 'PASS' && !now.crawled) {
        // On the very first run every sitemap URL predates the watcher, so there
        // is no grace period to give: anything Google has never fetched is
        // already overdue, and waiting a fortnight to say so would hide the
        // single most useful thing the first run has to report. Afterwards a URL
        // appearing for the first time really is new, and deserves the wait.
        const age = was?.first_seen ? daysBetween(was.first_seen, today()) : 0;
        if (firstRun || age >= T.neverCrawledDays || alreadyOpen(`never-crawled:${slug(key)}`)) {
          // One sentence that is true however the finding came to be open. The
          // age is context, never the justification — a finding kept open
          // because it is still true would otherwise report "(0 days)" and read
          // as though nothing were wrong. Google's own reason is the useful
          // half, so it stays in every variant rather than only the first.
          add('never-crawled', key,
            `never crawled — Google reports "${now.coverage ?? 'no reason given'}"`
            + (age > 0 ? `, and it has been in the sitemap since ${was.first_seen} (${age} days)` : ''),
            'Link to it from a page Google already crawls often. Discovery is an '
            + 'internal-linking problem, not a submission one — resubmitting a '
            + 'sitemap Google has already read changes nothing.');
        }
      } else if (now.verdict !== 'PASS') {
        // Fetched, and still not indexed. A different problem from never being
        // found, with a different fix, and the fix depends on why.
        add('not-indexed', key,
          `crawled ${now.crawled}, still not indexed — "${now.coverage ?? 'no reason given'}"`,
          notIndexedFix(now.coverage));
      } else if (now.verdict === 'PASS' && now.crawled
                 && daysBetween(now.crawled, today()) >= T.staleCrawlDays) {
        add('stale-crawl', key,
          `indexed, but last crawled ${now.crawled} (${daysBetween(now.crawled, today())} days ago)`,
          'Normal for a page that has not changed. Worth acting on only if the '
          + 'content did change and the old version is still what ranks.');
      }
    }
  }

  /* --- sitemap health -------------------------------------------- */
  if (sitemap) {
    const errs = Number(sitemap.errors ?? 0);
    const warns = Number(sitemap.warnings ?? 0);
    if (errs > 0) {
      add('sitemap-errors', 'sitemap',
        `Search Console reports ${errs} error${errs === 1 ? '' : 's'} in ${SITEMAP}`,
        'Open the Sitemaps report in Search Console for the per-URL reason.');
    } else if (warns > 0) {
      add('sitemap-warnings', 'sitemap',
        `Search Console reports ${warns} warning${warns === 1 ? '' : 's'} in ${SITEMAP}`,
        'Usually a URL that redirects or is blocked. Check the Sitemaps report.');
    }
  }

  /* --- search performance ---------------------------------------- */
  if (perf) {
    for (const row of perf.queries) {
      const q = String(row.keys[0]);
      const was = prev.queries[q];

      // A query that lost real ground. Ranking decay is silent otherwise: the
      // absolute position looks unremarkable until you know where it came from.
      if (was && row.impressions >= T.slipImpressions
          && row.position - was.position >= T.slipPositions) {
        add('position-slip', q,
          `slipped from position ${was.position.toFixed(1)} (${was.seen}) to `
          + `${row.position.toFixed(1)} on ${row.impressions} impressions`,
          'Something now outranks the page. Compare the results and decide whether '
          + 'the post is missing a section the winners cover.');
      }

      // Seen often, ranked close, rarely clicked. The one case where rewriting
      // a title and description actually moves the number.
      if (row.position > T.nearMissLow && row.position < T.nearMissHigh
          && row.impressions >= T.slipImpressions) {
        add('near-miss', q,
          `position ${row.position.toFixed(1)} on ${row.impressions} impressions, `
          + `${(row.ctr * 100).toFixed(1)}% CTR`,
          'Sharpen the <title> and meta description of the page that ranks for it, '
          + 'so the phrase people typed is visible in the result.');
      }
    }

    for (const row of perf.pages) {
      if (row.impressions >= T.zeroClickImpressions && row.clicks === 0) {
        add('zero-click', short(String(row.keys[0])),
          `${row.impressions} impressions and no clicks in ${DAYS} days `
          + `(position ${row.position.toFixed(1)})`,
          'Google shows it and nobody picks it. Either the title does not match '
          + 'the intent behind the query, or the position is too low to be seen.');
      }
    }
  }

  /* --- Bing ------------------------------------------------------- */
  /* Deliberately no Bing near-miss or position-slip. The fix for either would
     be the same title rewrite the Google finding already asks for, and a rule
     that duplicates its neighbour's fix is noise by the standard in AGENTS.md.
     The query data is still recorded — it just does not raise anything until
     there is a fix that belongs to it alone. */
  if (bingObs) {
    // Read from the accumulated ledger, not just this run's slice. Coverage is
    // built up over several days of rotating checks, and a URL checked on
    // Tuesday is still known on Wednesday. Only URLs Bing has actually been
    // asked about are counted: one never checked is an absence of evidence,
    // not evidence of absence, and must not become a finding.
    const known = Object.entries(bingState ?? {}).filter(([, v]) => v.checked);
    const missing = known.filter(([, v]) => !v.crawled).map(([u]) => u);

    if (known.length && missing.length > known.length / 2) {
      // A site-level fact, not a page-level one. Thirty-odd identical rows
      // would bury every other finding in the report to say a single thing.
      add('bing-coverage', 'site',
        `Bing has a crawl record for ${known.length - missing.length} of the `
        + `${known.length} sitemap URL${known.length === 1 ? '' : 's'} checked so far`,
        'Normal for a property added in the last few weeks — bingbot reaches a new '
        + 'site more slowly than Googlebot, and IndexNow only announces a URL, it '
        + 'does not schedule a crawl. Worth acting on if the number has not moved in '
        + 'a month: check the property is on the canonical host and that nothing '
        + 'blocks bingbot.');
    } else {
      for (const url of missing) {
        add('bing-not-indexed', short(url),
          'in the sitemap and announced through IndexNow, but Bing has no crawl record for it',
          'Bing keeps a small manual submission quota, which Google has no equivalent '
          + 'of. `npm run seo -- --bing-only --submit-urls` spends it. If the page is '
          + 'still missing a fortnight later, the problem is internal links or a '
          + 'blocked bingbot, not submission.');
      }
    }

    for (const row of bingObs.issues ?? []) {
      const names = bing.decodeIssues(row.Issues);
      if (!names.length) continue;
      add('bing-crawl-issue', short(String(row.Url ?? 'unknown')),
        `Bing reports ${names.join(', ')}`
        + (row.HttpCode ? ` (HTTP ${row.HttpCode})` : ''),
        bing.issueFix(names));
    }
  }

  const observed = new Set([
    ...(index ? KINDS.index : []),
    ...(sitemap ? KINDS.sitemap : []),
    ...(perf ? KINDS.perf : []),
    // Only when the Bing half actually returned. A skipped source proves
    // nothing, and must never be read as the problem having gone away.
    ...(bingObs ? KINDS.bing : []),
  ]);
  return { found, observed };
}

/* ------------------------------------------------------------------ */
/* close by hand                                                       */

if (CLOSE || WONTFIX) {
  const l = readLedger();
  const id = CLOSE || WONTFIX;
  const f = l.findings.find(x => x.id === id && x.status === 'open');
  if (!f) {
    console.error(`no open finding with id "${id}"`);
    console.error('open ids:');
    for (const x of l.findings.filter(x => x.status === 'open')) console.error(`  ${x.id}`);
    process.exit(1);
  }
  f.status = CLOSE ? 'fixed' : 'wontfix';
  f.closed = today();
  if (NOTE) f.note = NOTE;
  writeLedger(l);
  console.log(`${f.id} → ${f.status}${NOTE ? ` (${NOTE})` : ''}`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* brief — the work list, and nothing else                             */

if (BRIEF) {
  const l = readLedger();
  const open = l.findings.filter(f => f.status === 'open');
  if (!l.updated) {
    console.log('No ledger yet. Run `npm run seo:watch` first.');
    process.exit(0);
  }
  console.log(`# SEO findings — ${open.length} open (ledger updated ${l.updated})\n`);
  if (!open.length) {
    console.log('Nothing open. Search Console reports no regression and no near-miss worth acting on.');
    process.exit(0);
  }
  // Roughly: things that are broken, then things that are missing, then things
  // that are merely underperforming.
  const order = ['deindexed', 'sitemap-errors', 'bing-crawl-issue', 'never-crawled',
                 'not-indexed', 'bing-not-indexed', 'position-slip',
                 'sitemap-warnings', 'zero-click', 'near-miss', 'bing-coverage',
                 'stale-crawl'];
  const rank = f => { const i = order.indexOf(f.kind); return i === -1 ? order.length : i; };
  for (const f of open.sort((a, b) => rank(a) - rank(b))) {
    console.log(`## ${f.kind} — ${f.subject}`);
    console.log(`id:     ${f.id}`);
    console.log(`opened: ${f.opened}${f.seen !== f.opened ? ` (still true ${f.seen})` : ''}`);
    console.log(`what:   ${f.detail}`);
    console.log(`fix:    ${f.fix}\n`);
  }
  console.log('Close one with `npm run seo:watch -- --close=<id> --note="what you did"`.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* the run                                                             */

const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!raw && !bing.bingKey()) {
  console.error('Neither GOOGLE_SERVICE_ACCOUNT_JSON nor BING_API_KEY is set, so there is');
  console.error('nothing to observe. See docs/seo-automation.md for the one-time setup.');
  process.exit(1);
}

let token = null;
let property = null;
if (raw) {
  const sa = JSON.parse(raw);
  token = await googleToken(sa);
  property = await preflight(token, sa);
} else {
  say('- **Search Console** — skipped: `GOOGLE_SERVICE_ACCOUNT_JSON` is not set');
}

const urls = await liveUrls();
const prev = readLedger();
const stamp = today();

const index = (!token || NO_INSPECT || !property?.canInspect)
  ? null : await inspectAll(token, urls);
const perf = token ? await performance(token) : null;
const sitemap = token ? await sitemapHealth(token) : null;
const bingObs = await bingObserve(urls, prev);

if (!perf && !index && !bingObs) {
  say('Nothing could be read from either engine — the ledger was left alone.');
  process.exit(1);
}

/* --- roll the observations into the ledger ------------------------ */

const next = {
  site: SITE_URL,
  updated: stamp,
  runs: (prev.runs ?? 0) + 1,
  urls: {},
  queries: {},
  // Carried forward untouched when the Bing half did not run, so a missing key
  // loses the history rather than silently rewriting it as empty.
  bing: prev.bing ?? { site: null, urls: {}, queries: {} },
  findings: [],
};

if (bingObs) {
  next.bing = { site: bingObs.site, urls: {}, queries: {} };
  for (const u of urls) {
    const was = prev.bing?.urls?.[u];
    const now = bingObs.index[u];
    // When a URL was looked at this run its result stands, nulls included — a
    // page that fell out of Bing has to be able to show that. When it was not,
    // the previous answer carries forward untouched.
    next.bing.urls[u] = {
      first_seen: was?.first_seen ?? stamp,
      seen: stamp,
      checked: now ? stamp : (was?.checked ?? null),
      crawled: now ? now.crawled : (was?.crawled ?? null),
      http: now ? now.http : (was?.http ?? null),
    };
  }
  for (const r of bingObs.queries ?? []) {
    const was = prev.bing?.queries?.[r.query];
    next.bing.queries[r.query] = {
      first_seen: was?.first_seen ?? stamp,
      seen: stamp,
      position: r.position,
      impressions: r.impressions,
      clicks: r.clicks,
    };
  }
}

for (const u of urls) {
  const was = prev.urls[u];
  const now = index?.[u];
  next.urls[u] = {
    first_seen: was?.first_seen ?? stamp,
    seen: stamp,
    verdict: now?.verdict ?? was?.verdict ?? 'UNKNOWN',
    coverage: now?.coverage ?? was?.coverage ?? null,
    crawled: now?.crawled ?? was?.crawled ?? null,
  };
}

if (perf) {
  for (const row of perf.queries) {
    const q = String(row.keys[0]);
    const was = prev.queries[q];
    next.queries[q] = {
      first_seen: was?.first_seen ?? stamp,
      seen: stamp,
      position: Number(row.position.toFixed(1)),
      impressions: row.impressions,
      clicks: row.clicks,
      // the best it has ever done, so a slip is measured against the peak too
      best: Math.min(was?.best ?? Infinity, Number(row.position.toFixed(1))),
    };
  }
  // A query that stopped appearing entirely is kept one more run, so it can be
  // compared against; two silent runs and it is genuinely gone.
  for (const [q, was] of Object.entries(prev.queries)) {
    if (!next.queries[q] && was.seen === prev.updated) next.queries[q] = was;
  }
}

/* --- findings: open the new, keep the still-true, close the rest --- */

const { found: detected, observed } =
  detect({ index, perf, sitemap, bingObs, bingState: next.bing.urls, prev });
const byId = new Map(detected.map(f => [f.id, f]));
const opened = [], closed = [];

for (const old of prev.findings) {
  if (old.status !== 'open') {
    next.findings.push(old);                       // history, kept as written
  } else if (byId.has(old.id)) {
    const now = byId.get(old.id);
    next.findings.push({ ...old, detail: now.detail, fix: now.fix, seen: stamp });
    byId.delete(old.id);                           // still true, not new
  } else if (!observed.has(old.kind)) {
    next.findings.push(old);                       // not looked at — not resolved
  } else {
    next.findings.push({ ...old, status: 'resolved', closed: stamp });
    closed.push(old);                              // the condition stopped holding
  }
}

for (const f of byId.values()) {
  const entry = { ...f, opened: stamp, seen: stamp, status: 'open', closed: null, note: null };
  next.findings.push(entry);
  opened.push(entry);
}

writeLedger(next);

/* ------------------------------------------------------------------ */
/* the report                                                          */

const open = next.findings.filter(f => f.status === 'open');
const indexed = Object.values(next.urls).filter(u => u.verdict === 'PASS').length;

say(`### SEO watch — run ${next.runs}${DRY ? ' (dry run)' : ''}`);
say('');
// Never print a count for something this run did not look at: "0 indexed"
// reads as a catastrophe when it only means inspection was skipped.
say(`${urls.length} URLs in the sitemap. `
  + `**Google** — `
  + (index ? `${indexed} indexed.` : 'index not checked this run.')
  + (perf ? ` Performance window ${perf.start} to ${perf.end}.` : ''));

// Reported separately rather than summed. A page Google has and Bing does not
// is the interesting case, and one combined number is exactly what hides it.
if (bingObs) {
  const checked = Object.values(next.bing.urls).filter(u => u.checked).length;
  const crawled = Object.values(next.bing.urls).filter(u => u.crawled).length;
  const rows = Object.values(next.bing.queries);
  const clicks = rows.reduce((a, q) => a + q.clicks, 0);
  const imps = rows.reduce((a, q) => a + q.impressions, 0);
  say('');
  say(`**Bing** — ${crawled} of ${checked} checked URLs crawled `
    + `(${urls.length} in the sitemap)`
    + (imps
      ? `, ${clicks} click${clicks === 1 ? '' : 's'} from ${imps} impressions in ${DAYS} days.`
      : ', no impressions in the window.'));
}
say('');

if (opened.length) {
  say(`**${opened.length} new finding${opened.length === 1 ? '' : 's'}**`);
  say('');
  say('| What | Where | Detail |');
  say('|---|---|---|');
  for (const f of opened) say(`| ${f.kind} | \`${f.subject}\` | ${f.detail} |`);
  say('');
}

if (closed.length) {
  say(`**${closed.length} resolved** — the condition no longer holds: `
    + closed.map(f => `\`${f.id}\``).join(', '));
  say('');
}

if (!opened.length && !closed.length) {
  say(open.length
    ? `_Nothing changed. ${open.length} finding${open.length === 1 ? '' : 's'} still open._`
    : '_Nothing changed, and nothing is open._');
  say('');
}

if (open.length) {
  say(`${open.length} open in total. \`npm run seo:watch -- --brief\` prints them with their fixes.`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}
