#!/usr/bin/env node
/**
 * Tell the search engines the site changed, then report back what Google has
 * actually done with it. Pure Node, no dependencies. Runs against the *live*
 * site, so it needs a deploy to have happened first — it never reads dist/.
 *
 * Three things happen, each independent and each skippable:
 *
 *   1. IndexNow      — instant push to Bing, DuckDuckGo, Yandex and Copilot.
 *                      Needs no credentials, only the key file at the root.
 *   2. Sitemap submit — Search Console API. Google removed the old public
 *                      /ping?sitemap= endpoint in June 2023, so this is the
 *                      only supported way left to nudge it.
 *   4. Search performance — Search Console API. What each page and query
 *                      actually earns: clicks, impressions, CTR, position.
 *                      Google's data about its own results, not a tracker on
 *                      this site — nothing runs in anyone's browser.
 *
 *   3. URL inspection — Search Console API. Reports, per URL, whether Google
 *                      has it indexed. This is the part worth reading: it
 *                      separates "Google hasn't found it" from "Google found
 *                      it and nobody searches for it", which are very
 *                      different problems with very different fixes.
 *
 * Deliberately NOT here: the Google Indexing API. It only accepts JobPosting
 * and BroadcastEvent pages; calling it for anything else breaks Google's terms
 * and is ignored regardless.
 *
 * Environment:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service-account key, whole JSON blob.
 *                                Absent -> steps 2 and 3 are skipped.
 *   GSC_SITE_URL                 Search Console property. Defaults to the
 *                                URL-prefix property for the canonical host.
 *                                Use sc-domain:indiecore.net for a Domain one.
 *
 * Flags:
 *   --dry-run      resolve everything, send nothing.
 *   --days=N       search-performance window (default 28).
 *   --no-google    skip steps 2 and 3 even when credentials are present.
 *   --submit-only  announce and submit, but skip the reporting in steps 3 and 4.
 *                  scripts/seo-watch.mjs reports those, with history.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SITE = 'https://www.indiecore.net';
const HOST = new URL(SITE).host;
const SITEMAP = `${SITE}/sitemap.xml`;
const SCOPE = 'https://www.googleapis.com/auth/webmasters';

const argv = new Set(process.argv.slice(2));
const DRY = argv.has('--dry-run');
const SKIP_GOOGLE = argv.has('--no-google');
// Announce only. scripts/seo-watch.mjs inspects the same URLs and reads the same
// performance data, but keeps a ledger so it can report what CHANGED — running
// both in full spends minutes of billed CI on identical API calls for a strictly
// worse version of the same report.
const SUBMIT_ONLY = argv.has('--submit-only');
const SITE_URL = process.env.GSC_SITE_URL || `${SITE}/`;

const KEY = fs.readFileSync(
  path.join(import.meta.dirname, '..', '_source/indexnow-key.txt'), 'utf8').trim();

const summary = [];
const say = line => { console.log(line); summary.push(line); };

/* ------------------------------------------------------------------ */
/* the live URL list                                                   */

async function liveUrls() {
  const res = await fetch(SITEMAP, { headers: { 'user-agent': 'indiecore-seo-ping' } });
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  if (!urls.length) throw new Error('sitemap contained no <loc> entries');
  return urls;
}

/* ------------------------------------------------------------------ */
/* 1. IndexNow                                                         */

async function indexNow(urls) {
  const keyLocation = `${SITE}/${KEY}.txt`;

  // The submission is rejected outright if the key file is not readable, and
  // that failure is opaque at the API. Check it here so the log names the cause.
  const probe = await fetch(keyLocation);
  if (!probe.ok || (await probe.text()).trim() !== KEY) {
    say(`- **IndexNow** — skipped: \`${keyLocation}\` is not serving the key (deploy first)`);
    return;
  }

  if (DRY) { say(`- **IndexNow** — dry run, would submit ${urls.length} URLs`); return; }

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation, urlList: urls }),
  });

  // 200 accepted, 202 accepted but key still being validated. Both are fine.
  if (res.status === 200 || res.status === 202) {
    say(`- **IndexNow** — submitted ${urls.length} URLs (HTTP ${res.status})`);
  } else {
    say(`- **IndexNow** — FAILED: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------ */
/* Google auth — service-account JWT exchanged for an access token      */

const b64url = buf => Buffer.from(buf).toString('base64url');

async function googleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
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

/* ------------------------------------------------------------------ */
/* 2. sitemap submit                                                   */

async function submitSitemap(token) {
  if (DRY) { say(`- **Sitemap** — dry run, would resubmit ${SITEMAP}`); return; }

  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}`
            + `/sitemaps/${encodeURIComponent(SITEMAP)}`;
  const res = await fetch(url, { method: 'PUT', headers: { authorization: `Bearer ${token}` } });

  if (res.ok) {
    say(`- **Sitemap** — resubmitted to Search Console (HTTP ${res.status})`);
  } else {
    const detail = (await res.text()).slice(0, 300);
    say(`- **Sitemap** — FAILED: HTTP ${res.status} ${detail}`);
    if (res.status === 403) say(`  - the service account is not a user on \`${SITE_URL}\``);
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------ */
/* 3. URL inspection — the part that answers "does Google know about me"  */

async function inspect(token, urls) {
  if (DRY) { say(`- **Index status** — dry run, would inspect ${urls.length} URLs`); return; }

  const rows = [];
  for (const u of urls) {
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: u, siteUrl: SITE_URL, languageCode: 'en-US' }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      say(`- **Index status** — FAILED on ${u}: HTTP ${res.status} ${detail}`);
      if (res.status === 403) say('  - URL inspection needs the service account to be an *owner* of the property');
      process.exitCode = 1;
      return;
    }

    const r = (await res.json()).inspectionResult?.indexStatusResult ?? {};
    rows.push({
      url: u.replace(SITE, '') || '/',
      verdict: r.verdict ?? 'UNKNOWN',
      coverage: r.coverageState ?? '—',
      crawled: r.lastCrawlTime ? r.lastCrawlTime.slice(0, 10) : 'never',
    });
  }

  const indexed = rows.filter(r => r.verdict === 'PASS').length;
  say('');
  say(`### Index status — ${indexed}/${rows.length} indexed`);
  say('');
  say('| URL | Verdict | Coverage | Last crawled |');
  say('|---|---|---|---|');
  for (const r of rows) say(`| \`${r.url}\` | ${r.verdict} | ${r.coverage} | ${r.crawled} |`);

  if (indexed === rows.length) {
    say('');
    say('_Every URL is indexed. If traffic is still flat, the bottleneck is ranking '
      + 'or demand — not discovery, and no amount of pinging will move it._');
  }
}

/* ------------------------------------------------------------------ */
/* 4. search performance — what the pages actually earn                 */
/*                                                                      */
/* Search Console reports on Google's own search results, not on people */
/* browsing this site: no script runs on the pages, nothing is stored on */
/* anyone's device, and the rows come back aggregated and anonymised by  */
/* Google. That is the whole reason this site can measure its reach and  */
/* still say, truthfully, that it runs no analytics on its visitors.     */

const ymd = d => d.toISOString().slice(0, 10);

async function searchPerformance(token) {
  const days = Number((process.argv.find(a => a.startsWith('--days=')) || '').split('=')[1]) || 28;
  const end   = new Date(Date.now() - 2 * 864e5);   // Search Console lags ~2 days
  const start = new Date(end.getTime() - (days - 1) * 864e5);

  if (DRY) { say(`- **Search performance** — dry run, would query the last ${days} days`); return; }

  const query = async (dimension, rowLimit) => {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), dimensions: [dimension], rowLimit }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      say(`- **Search performance** — FAILED (${dimension}): HTTP ${res.status} ${detail}`);
      if (res.status === 403) say(`  - the service account is not a user on \`${SITE_URL}\``);
      process.exitCode = 1;
      return null;
    }
    return (await res.json()).rows ?? [];
  };

  const [queries, pages] = await Promise.all([query('query', 20), query('page', 20)]);
  if (!queries || !pages) return;

  const total = pages.reduce((a, r) => ({
    clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions,
  }), { clicks: 0, impressions: 0 });

  say('');
  say(`### Search performance — ${ymd(start)} to ${ymd(end)}`);
  say('');

  if (!total.impressions) {
    say('_No impressions in this window. For a page Google has only just indexed that is '
      + 'normal — it means nobody has searched anything it ranks for yet, which is a demand '
      + 'problem rather than a technical one._');
    return;
  }

  const ctr = total.impressions ? (total.clicks / total.impressions * 100).toFixed(1) : '0.0';
  say(`**${total.clicks} clicks** from **${total.impressions} impressions** (${ctr}% CTR)`);

  const table = (title, rows, label) => {
    if (!rows.length) return;
    say('');
    say(`**${title}**`);
    say('');
    say(`| ${label} | Clicks | Impressions | CTR | Position |`);
    say('|---|--:|--:|--:|--:|');
    for (const r of rows.slice(0, 10)) {
      const key = String(r.keys[0]).replace(SITE, '') || '/';
      say(`| \`${key}\` | ${r.clicks} | ${r.impressions} | `
        + `${(r.ctr * 100).toFixed(1)}% | ${r.position.toFixed(1)} |`);
    }
  };

  table('Top queries', queries.sort((a, b) => b.impressions - a.impressions), 'Query');
  table('Top pages',   pages.sort((a, b) => b.impressions - a.impressions), 'Page');

  /* The rows worth acting on: seen often, rarely clicked, and close enough to
     page one that a better title or description can move them. */
  const nearMiss = queries.filter(r => r.position > 5 && r.position < 21 && r.impressions >= 20);
  if (nearMiss.length) {
    say('');
    say(`_${nearMiss.length} quer${nearMiss.length === 1 ? 'y is' : 'ies are'} ranking between `
      + '5 and 20 with real impressions — those are the ones where a sharper title or '
      + 'description changes the number, rather than more writing._');
  }
}

/* ------------------------------------------------------------------ */

const urls = await liveUrls();
say(`### SEO ping${DRY ? ' (dry run)' : ''}`);
say('');
say(`${urls.length} URLs in \`${SITEMAP}\``);
say('');

await indexNow(urls);

const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (SKIP_GOOGLE) {
  say('- **Google** — skipped (`--no-google`)');
} else if (!raw) {
  say('- **Google** — skipped: `GOOGLE_SERVICE_ACCOUNT_JSON` is not set');
} else {
  const sa = JSON.parse(raw);
  const token = await googleToken(sa);
  await submitSitemap(token);
  if (SUBMIT_ONLY) {
    say('- **Index status and performance** — skipped (`--submit-only`); '
      + '`npm run seo:watch` reports those, and can say what changed');
  } else {
    await inspect(token, urls);
    await searchPerformance(token);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}
