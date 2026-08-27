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
 *   --dry-run    resolve everything, send nothing.
 *   --no-google  skip steps 2 and 3 even when credentials are present.
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
  await inspect(token, urls);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}
