/**
 * Bing Webmaster Tools API — the shared client, used by seo-ping.mjs and
 * seo-watch.mjs. Pure Node, no dependencies, same as everything else here.
 *
 * Why this file exists at all: IndexNow already tells Bing when a URL changes,
 * and it needs no credentials. What it cannot do is answer back. Everything
 * pointed at Bing was write-only — we announced and never learned whether it
 * worked. This is the read half, so Bing gets the same treatment Google does:
 * an observation, a ledger entry, and a finding that names its own fix.
 *
 * PROTOCOL — read this before "fixing" the endpoint.
 * Microsoft retired the SOAP and POX APIs on 31 August 2026. It did NOT retire
 * this one. JSON-over-HTTP *is* the REST API the retirement notice tells you to
 * migrate to: same key, same quotas, same method names. A search for "Bing
 * Webmaster API retirement" turns up a wall of headlines that read as though
 * the whole API is gone, which is how a working integration gets deleted by
 * someone doing the responsible thing.
 *   https://learn.microsoft.com/en-us/bingwebmaster/api-protocols
 *
 * SHAPE. Every call is
 *   GET  https://ssl.bing.com/webmaster/api.svc/json/<Method>?apikey=K&param=V
 *   POST https://ssl.bing.com/webmaster/api.svc/json/<Method>?apikey=K   + JSON body
 * and every response wraps its payload in a single `d` node, because this is a
 * WCF service wearing a REST hat. Dates come back as "/Date(1712345678000)/",
 * milliseconds since the epoch in a string, not ISO-8601.
 *
 * Environment:
 *   BING_API_KEY   from Bing Webmaster Tools -> Settings -> API access -> API key.
 *                  Absent -> every caller here skips, the way the Google half
 *                  skips without GOOGLE_SERVICE_ACCOUNT_JSON.
 *   BING_SITE_URL  optional override for the registered site. Normally the
 *                  resolver below works it out, which is better than a constant
 *                  because Bing is strict about the exact string.
 */

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

export const bingKey = () => process.env.BING_API_KEY || '';

/** Bing's DateTime encoding: "/Date(1712345678000)/" -> "2026-04-05", or null. */
export function msDate(v) {
  if (!v) return null;
  const m = /\/Date\((-?\d+)/.exec(String(v));
  if (!m) return null;
  const d = new Date(Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * One call. Returns { ok, data } rather than throwing, because a Bing outage
 * must not fail a deploy report or, worse, let seo-watch read "no data" as
 * "your pages were deindexed" and resolve findings that are still true.
 */
export async function call(method, { params = {}, body = null } = {}) {
  const key = bingKey();
  if (!key) return { ok: false, error: 'BING_API_KEY is not set' };

  const url = new URL(`${BASE}/${method}`);
  url.searchParams.set('apikey', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'indiecore-seo',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    return { ok: false, error: `${method}: network error — ${e.message}` };
  }

  const text = await res.text();
  if (!res.ok) {
    // The key is in the query string, so it lands in any error we echo. Redact
    // before this reaches a job summary — those are readable by anyone who can
    // see the repo, and a leaked key is a re-issue plus a secret rotation.
    const detail = text.replace(new RegExp(key, 'g'), '<redacted>').slice(0, 300);
    return { ok: false, status: res.status, error: `${method}: HTTP ${res.status} ${detail}` };
  }

  try {
    // `d` is the WCF envelope. A method returning nothing still sends `{"d":null}`.
    return { ok: true, data: JSON.parse(text).d ?? null };
  } catch {
    return { ok: false, error: `${method}: response was not JSON` };
  }
}

/* ------------------------------------------------------------------ */
/* which site, exactly                                                 */

/**
 * Bing matches `siteUrl` against the registered string, so ask which sites the
 * key can see and hand back the exact string Bing itself uses — never a
 * constant of ours that has to be kept in step by hand.
 *
 * WWW AND APEX ARE ONE SITE HERE. Bing normalises the host: a property
 * registered as https://indiecore.net/ answers for https://www.indiecore.net/
 * URLs too, which is why the UI refuses to add the second variant and says
 * "Site already added". Verified against the live API — GetUrlInfo for a www
 * URL returns a real crawl record under the apex property, and the www sitemap
 * is registered against it. Matching on the exact host would therefore fire a
 * mismatch warning on every single run and be wrong every time, which is how a
 * report earns being ignored. So compare registrable domains, and warn only
 * when the registered site is genuinely somewhere else.
 */
const domainOf = host => host.replace(/^www\./, '');

export async function resolveSite(wantedHost) {
  const res = await call('GetUserSites');
  if (!res.ok) return { ok: false, error: res.error };

  const sites = (res.data ?? []).map(s => ({
    url: s.Url,
    verified: s.IsVerified !== false,
    host: (() => { try { return new URL(s.Url).host; } catch { return null; } })(),
  })).filter(s => s.host);

  if (!sites.length) {
    return { ok: false, error: 'this API key can see no sites in Bing Webmaster Tools' };
  }

  const match = sites.find(s => domainOf(s.host) === domainOf(wantedHost));
  if (match) return { ok: true, site: match, sites, canonical: true };

  // A different domain entirely. Fall back so the run still produces data, and
  // let the caller say which property it actually read.
  return { ok: true, site: sites[0], sites, canonical: false };
}

/* ------------------------------------------------------------------ */
/* the methods this repo actually uses                                 */

export const getUrlInfo = (siteUrl, url) => call('GetUrlInfo', { params: { siteUrl, url } });
export const getCrawlIssues = siteUrl => call('GetCrawlIssues', { params: { siteUrl } });
export const getQueryStats = siteUrl => call('GetQueryStats', { params: { siteUrl } });
export const getPageStats = siteUrl => call('GetPageStats', { params: { siteUrl } });
export const getFeeds = siteUrl => call('GetFeeds', { params: { siteUrl } });
export const getUrlSubmissionQuota = siteUrl => call('GetUrlSubmissionQuota', { params: { siteUrl } });
export const submitFeed = (siteUrl, feedUrl) => call('SubmitFeed', { body: { siteUrl, feedUrl } });
export const submitUrlBatch = (siteUrl, urlList) => call('SubmitUrlBatch', { body: { siteUrl, urlList } });

/* ------------------------------------------------------------------ */
/* crawl issues                                                        */

/**
 * `Issues` is a .NET [Flags] enum. The member NAMES are documented; the numeric
 * values are not published anywhere Microsoft still hosts, and the JSON
 * serialiser sends the number. Guessing the bit layout would produce confident,
 * wrong diagnoses — the worst possible output for a tool whose whole job is to
 * name a fix.
 *
 * So: decode the bits we can source, and surface anything else as `bit N`
 * rather than dropping it. An unrecognised issue still shows up and still gets
 * looked at; it just says "I do not know this one" instead of inventing a
 * meaning. HttpCode is reported alongside regardless, and is usually the more
 * actionable half anyway.
 */
const ISSUE_BITS = [
  [2, 'BlockedByRobotsTxt', 'robots.txt blocks it. Check the Disallow rules in build.mjs.'],
  [4, 'Code301', 'permanent redirect. If the sitemap lists it, list the destination instead.'],
  [8, 'Code302', 'temporary redirect. Make it a 301 if the move is permanent.'],
  [16, 'Code4xx', 'the page errors. A 404 in the sitemap is a dead internal link.'],
  [32, 'Code5xx', 'the server errored while Bing was fetching it.'],
];

export function decodeIssues(raw) {
  // Some deployments hand back a comma-joined name list rather than a number.
  if (typeof raw === 'string' && !/^\d+$/.test(raw)) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  const n = Number(raw) || 0;
  if (!n) return [];

  const names = [];
  let seen = 0;
  for (const [bit, name] of ISSUE_BITS) {
    if (n & bit) { names.push(name); seen |= bit; }
  }
  // Whatever is left is a flag we cannot name. Say so, precisely.
  for (let b = 1; b <= n; b <<= 1) {
    if ((n & b) && !(seen & b)) names.push(`bit ${b}`);
  }
  return names;
}

/** The fix a named issue implies. Unknown names get an honest fallback. */
export function issueFix(names) {
  for (const [, name, fix] of ISSUE_BITS) if (names.includes(name)) return fix;
  return 'Open the Crawl information report in Bing Webmaster Tools for the detail.';
}
