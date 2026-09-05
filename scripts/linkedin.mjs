#!/usr/bin/env node
/**
 * Posts a blog post to LinkedIn, as you, with the article's URL.
 *
 *   node scripts/linkedin.mjs                 # dry run: the exact text that would be posted
 *   node scripts/linkedin.mjs --publish       # post it, after showing it and asking
 *   node scripts/linkedin.mjs --only <slug>   # just one
 *   node scripts/linkedin.mjs --limit N       # post more than one in a run (default 1)
 *   node scripts/linkedin.mjs --force         # post one the ledger says is already out
 *   node scripts/linkedin.mjs --no-thumbnail  # link card without the image
 *   node scripts/linkedin.mjs --json          # also print the request body
 *   node scripts/linkedin.mjs --check-token   # days left on the token, and its scopes
 *
 * Opt in per post with `linkedin: true` in the frontmatter. Nothing is posted
 * for a post without it, for a draft, or for a post dated ahead of today — the
 * link would 404, which is the one thing a promotional post must not do.
 *
 * The flag is a veto, not a vote: `linkedin: false` still means never, and
 * nothing here can overrule one, which is what keeps the required decision on
 * every post meaningful. Among the posts that said yes, the one with the most
 * demand behind it goes first — the queue is ordered by scripts/platforms.mjs
 * rather than by date, because a feed slot is the scarcest thing here and
 * spending it on whichever post is oldest is spending it at random.
 *
 * This is not the dev.to cross-post, and the difference matters. dev.to gets a
 * copy of the article and therefore needs a canonical tag pointing back here or
 * it competes with the original. LinkedIn gets a few lines of commentary and a
 * link card: there is no copy of the prose, so there is nothing to canonicalise
 * and nothing that can outrank the post it is promoting. The link is the whole
 * point of the post rather than a footnote on it.
 *
 * ── The token, and what the workflow has to do about it ──────────────────────
 *
 * LinkedIn access tokens last 60 days, and programmatic refresh tokens are
 * available to approved Marketing Developer Platform partners only — for an
 * ordinary app there is no way to renew one without a person in a browser. So
 * `linkedin.yml` runs this on a schedule and the token underneath it dies six
 * times a year no matter what the workflow does.
 *
 * That is why `--check-token` exists and why the workflow runs it on every run,
 * before it looks at whether there is anything to post. The failure this guards
 * against is not a red workflow — it is a green one with nothing in it, on a
 * day a post should have gone out. The check warns from fourteen days out,
 * which is enough notice to renew between two posts rather than during one.
 *
 * Mint a token at https://www.linkedin.com/developers/tools/oauth/token-generator
 * against an app carrying two self-serve products — **Share on LinkedIn** for
 * `w_member_social`, and **Sign In with LinkedIn using OpenID Connect** for
 * `profile`. They are separate products and it is the second one people forget,
 * because posting works without it and the author lookup then 403s. Export it:
 *
 *   export LINKEDIN_ACCESS_TOKEN=...
 *   export LINKEDIN_AUTHOR_URN=urn:li:person:...   # optional, saves a lookup
 *
 * `--check-token` additionally needs LINKEDIN_CLIENT_ID and
 * LINKEDIN_CLIENT_SECRET, from the app's Auth tab. They introspect the token
 * and nothing else — neither can post, and neither can mint a token on its own.
 *
 * Posting to a *company page* instead would need `w_organization_social`, which
 * is behind LinkedIn's Community Management API review. Nothing here asks for
 * it: set LINKEDIN_AUTHOR_URN to an organisation URN and it would work, on a
 * token that is not self-serve to get.
 *
 * ── Posting once ─────────────────────────────────────────────────────────────
 *
 * A LinkedIn post cannot be meaningfully updated — the commentary can be
 * patched but the link card cannot — so unlike dev.to there is no re-run that
 * edits what is already there. The ledger records the post URN, and a slug in
 * it is skipped. `--force` posts anyway, which duplicates it on the feed on
 * purpose; there is no undo short of deleting it in the LinkedIn UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { frontmatter } from './frontmatter.mjs';
import { byDemand, capFor } from './platforms.mjs';
import { readLedger as readTopics } from './topic-seo.mjs';

const ROOT   = path.resolve(import.meta.dirname, '..');
/* content/blog only, and deliberately. The ASO keyword reports in content/aso
   are site-only: they are never cross-posted or announced anywhere off this
   domain. See "Never break these" in AGENTS.md before widening this path. */
const BLOG   = path.join(ROOT, 'content/blog');
const LEDGER = path.join(ROOT, '_source/linkedin.json');
const SITE   = 'https://www.indiecore.net';
const TODAY  = new Date().toISOString().slice(0, 10);   // UTC, same clock as the build
const API    = 'https://api.linkedin.com';

/* LinkedIn's versioned APIs take the version in the URL's stead, as a header in
   YYYYMM form, and retire each one about a year after it ships. When a run
   starts failing with 426 or "version not supported", bump this — the endpoint
   shapes used here have not changed across versions. */
const VERSION = process.env.LINKEDIN_API_VERSION || '202608';

/* LinkedIn's own limit on commentary. Hitting it fails the whole request with
   FIELD_LENGTH_TOO_LONG, so it is checked before anything is sent. */
const MAX_COMMENTARY = 3000;

/* The image every blog post shares — the site has no per-post OG image, so one
   upload is reused for all of them by way of the ledger's image cache. */
const THUMBNAIL = path.join(ROOT, 'public/assets/og/default.jpg');

/* ───────── arguments ───────── */

const args      = process.argv.slice(2);
const publish   = args.includes('--publish');
const force     = args.includes('--force');
const noThumb   = args.includes('--no-thumbnail');
const yes       = args.includes('--yes');
/* The dry run's job is proofreading the prose; this is the other half, for when
   LinkedIn rejects a request and the answer is in the bytes. Same flag, same
   reason, as devto.mjs's --dump. */
const showJson  = args.includes('--json');

/* indexOf returns -1 when a flag is absent, and args[-1 + 1] is args[0] — so a
   missing value silently reads the next flag as the value. devto.mjs shipped
   that bug; it is worth the six lines here to not ship it twice. */
function value(flag, example) {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const v = args[at + 1];
  if (!v || v.startsWith('--')) {
    console.error(`${flag} needs a value after it, e.g. ${flag} ${example}`);
    process.exit(1);
  }
  return v;
}

const only  = value('--only', 'unity-gradle-build-failed-is-not-the-error');
const limit = value('--limit', '2');
if (limit !== undefined && !/^\d+$/.test(limit)) {
  console.error('--limit needs a whole number after it, e.g. --limit 2');
  process.exit(1);
}
/* One per run by default, and a few a week. This is a personal feed, not a
   publication: two links posted a minute apart read as a bot, and the second
   earns less reach than it would have earned tomorrow. Both numbers live in
   _source/schedule.json so the site's calendar and the feed's budget are one
   file; --limit overrides them deliberately or not at all. */
const quotaOf = posted => capFor('linkedin', { posted, today: TODAY });

const TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;

/* ───────── the ledger ───────── */

const EMPTY = { posts: {}, images: {} };

function readLedger() {
  if (!fs.existsSync(LEDGER)) return structuredClone(EMPTY);
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(LEDGER, 'utf8')) };
  } catch (e) {
    console.error(`${path.relative(ROOT, LEDGER)} is not valid JSON: ${e.message}`);
    process.exit(1);
  }
}

/* Written after every post rather than at the end of the run: a run that dies
   halfway must not forget what it already put on the feed, because the cost of
   forgetting is a duplicate nobody can un-post. */
const writeLedger = l => fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + '\n');

const ledger = readLedger();

/* ───────── composing the post ───────── */

/* `little` is LinkedIn's text format for commentary. Every one of these
   characters is reserved by it — for mentions, hashtag templates and the like —
   and every one must be backslash-escaped even where it is plainly not being
   used as markup. An unescaped `(` in a title does not render as a bracket; it
   makes the whole commentary fail to parse.
   Single-pass on purpose: escaping `\` in a second pass would double every
   escape the first pass just wrote. */
const little = text => String(text).replace(/[|{}@[\]()<>#\\*_~]/g, c => '\\' + c);

/* A hashtag is a template rather than a literal `#tag`, and the `#` inside it
   carries its own escape. Three at most: past that LinkedIn shows them as a
   wall of blue and readers stop seeing any of them. */
const hashtags = tags => (tags ?? [])
  .map(t => String(t).toLowerCase().replace(/[^a-z0-9]/g, ''))
  .filter(Boolean)
  .slice(0, 3)
  .map(t => `{hashtag|\\#|${t}}`)
  .join(' ');

/* The reverse of `little`, for the dry run only. What gets sent is full of
   backslashes and hashtag templates, and nobody can proofread a paragraph
   through those — which is the whole job the dry run has. This renders what a
   reader will see; the character count stays that of what is actually sent. */
const readable = text => text
  .replace(/\{hashtag\|\\?[#\uFF03]\|([^}]+)\}/g, '#$1')
  .replace(/\\([|{}@[\]()<>#\\*_~])/g, '$1');

/* LinkedIn turns anything shaped like a domain into a link, and it does not
   check that the domain exists. The first post out of this script said
   "mainTemplate.gradle" and LinkedIn published it as a link to
   http://maintemplate.gradle/ — a dead host, in the middle of a paragraph about
   reading build logs.

   Nothing in the little format prevents this: escaping a dot is not a thing,
   and a zero-width character would break anyone copying the text. The only fix
   is to not write the token, so this finds them and says so. Real URLs are
   stripped first, and this site's own host is allowed — writing the domain bare
   in a blurb should link where it points. */
const SITE_HOST = new URL(SITE).host.replace(/^www\./, '');
const autolinks = text => [...new Set(
  [...text.replace(/https?:\/\/\S+/g, ' ').matchAll(/\b[a-z0-9][\w-]*\.[a-z]{2,24}\b/gi)]
    .map(m => m[0])
    .filter(h => !h.toLowerCase().endsWith(SITE_HOST)),
)];

function commentary(meta, url) {
  /* `linkedinText` is a block list, one paragraph per item, for the posts worth
     writing a real blurb for. Without it the post gets its own title and
     description, which is a serviceable default and a dull one. */
  const written = Array.isArray(meta.linkedinText) ? meta.linkedinText
    : meta.linkedinText ? [meta.linkedinText]
    : null;
  const paragraphs = written ?? [meta.title, meta.description].filter(Boolean);

  /* The URL is in the text as well as on the card. The card is the thing people
     click; the text is the thing they copy when they quote the post elsewhere,
     and a quote without the link is a dead end. */
  return [paragraphs.map(little).join('\n\n'), url, hashtags(meta.tags)]
    .filter(Boolean).join('\n\n');
}

function queue() {
  const out = [];
  for (const f of fs.readdirSync(BLOG).filter(f => f.endsWith('.md') && !f.startsWith('_'))) {
    const slug = f.replace(/\.md$/, '');
    if (only && slug !== only) continue;
    const parsed = frontmatter(fs.readFileSync(path.join(BLOG, f), 'utf8'));
    if (!parsed) continue;
    const { meta } = parsed;
    if (meta.linkedin !== true) continue;   // opt in, one post at a time
    if (meta.draft) continue;               // never promote something the site does not show
    /* Same rule as the dev.to cross-post: the link is the entire content of a
       LinkedIn post, so posting before the page exists puts a 404 on the feed
       where the article should be. The build releases the post on its date;
       run this after that. */
    if (String(meta.date ?? '') > TODAY) continue;

    const url  = `${SITE}/blog/${slug}/`;
    /* Reserved characters in a URL would have to be escaped, and an escaped URL
       may not autolink. No slug in this repo can contain one, so this is a
       guard rather than a case to handle — but it fails loudly if that ever
       stops being true, instead of posting a broken link. */
    if (/[|{}@[\]()<>#\\*_~]/.test(url)) {
      console.error(`/blog/${slug}/ contains a character LinkedIn reserves — rename the file.`);
      process.exit(1);
    }
    out.push({ slug, meta, url, text: commentary(meta, url) });
  }
  /* Ranked, with the publish date only breaking ties. Ordered here rather than
     at the call site so a dry run prints the same queue --publish sends. */
  return byDemand(out, readTopics());
}

/* ───────── the API ───────── */

async function api(method, endpoint, body, extra = {}) {
  const res = await fetch(API + endpoint, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'linkedin-version': VERSION,
      'x-restli-protocol-version': '2.0.0',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    console.error('\nLinkedIn rejected the token (401).');
    console.error('Access tokens last 60 days and cannot be refreshed without a browser.');
    console.error('Mint a new one at https://www.linkedin.com/developers/tools/oauth/token-generator');
    console.error('and export it as LINKEDIN_ACCESS_TOKEN.');
    process.exit(1);
  }
  if (res.status === 403) {
    console.error('\nLinkedIn refused the request (403) — the token is valid but lacks a scope.');
    console.error('Posting needs `w_member_social`, from the "Share on LinkedIn" product on your app.');
    console.error(await res.text().catch(() => ''));
    process.exit(1);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}\n${text.slice(0, 600)}`);
  return { res, json: text ? JSON.parse(text) : null };
}

/** the person the token belongs to, as the URN the Posts API wants as `author` */
async function author() {
  if (process.env.LINKEDIN_AUTHOR_URN) return { urn: process.env.LINKEDIN_AUTHOR_URN, name: null };
  /* /v2/userinfo is the OIDC endpoint and is not versioned; it needs the
     `profile` scope, which a token minted for posting alone will not have. */
  const res = await fetch(`${API}/v2/userinfo`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    console.error(`\nCould not read who the token belongs to (${res.status}).`);
    console.error('Either add the `profile` scope to the token, or set LINKEDIN_AUTHOR_URN');
    console.error('to your own `urn:li:person:...` — the Posts API needs one or the other.');
    process.exit(1);
  }
  const { sub, name } = await res.json();
  return { urn: `urn:li:person:${sub}`, name };
}

/**
 * Uploads the link-card image and returns its URN.
 *
 * Cached in the ledger by the file's hash, because every post shares one image
 * and LinkedIn lets an uploaded image be reused across posts. Re-uploading the
 * same bytes for every post would work and would litter the account with
 * identical assets.
 */
async function thumbnail(owner) {
  if (noThumb || !fs.existsSync(THUMBNAIL)) return null;
  const bytes = fs.readFileSync(THUMBNAIL);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  if (ledger.images[sha]) return ledger.images[sha];

  const { json } = await api('POST', '/rest/images?action=initializeUpload',
    { initializeUploadRequest: { owner } });
  const { uploadUrl, image } = json.value;

  /* No content-type: LinkedIn's upload endpoint reads the bytes, and sending
     one it does not expect is a way to fail an upload that would work. */
  const up = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: bytes,
  });
  if (!up.ok) throw new Error(`image upload → ${up.status} ${await up.text().catch(() => '')}`);

  ledger.images[sha] = image;
  writeLedger(ledger);
  return image;
}

function articlePost(p, owner, image) {
  return {
    author: owner,
    commentary: p.text,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: {
      article: {
        source: p.url,
        title: p.meta.title,
        ...(p.meta.description ? { description: p.meta.description } : {}),
        ...(image ? { thumbnail: image } : {}),
      },
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
}

const ask = q => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, a => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
});

/* ───────── the token's remaining life ───────── */

/* Fourteen days: long enough to renew between two posts rather than in the
   middle of one, short enough that the warning still means something when it
   appears. */
const WARN_DAYS = 14;

/**
 * Reports how long the token has left, and whether it can still post.
 *
 * Introspection is a separate endpoint from the API itself and takes the app's
 * own credentials rather than the token's authority, which is what makes this
 * safe to run on a schedule: it can read a token's status and it cannot use it.
 */
async function checkToken() {
  const id = process.env.LINKEDIN_CLIENT_ID;
  const secret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!TOKEN) { console.error('LINKEDIN_ACCESS_TOKEN is not set — nothing to check.'); return 1; }
  if (!id || !secret) {
    console.log('LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET are not set, so the token');
    console.log('cannot be introspected. Both are on the app\'s Auth tab. Skipping the check.');
    return 0;
  }

  const res = await fetch('https://www.linkedin.com/oauth/v2/introspectToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, token: TOKEN }),
  });
  /* 400 is a bad client id or an unreadable token, 401 a bad secret. Both mean
     the check itself is misconfigured rather than that the token is dead, and
     saying so is the difference between renewing a good token and fixing a
     secret. */
  if (!res.ok) {
    console.error(`introspection failed → ${res.status} ${await res.text().catch(() => '')}`);
    console.error(res.status === 401
      ? 'A 401 here is the client secret, not the access token.'
      : 'A 400 here is usually the client id, or a token from a different app.');
    return 1;
  }

  const t = await res.json();
  const scopes = (t.scope || '').split(',').map(s => s.trim()).filter(Boolean);

  /* A token can be valid, unexpired and still unable to post: LinkedIn
     invalidates every existing token when a different scope set is requested,
     so renewing with a shorter list produces exactly this. */
  if (t.active && !scopes.includes('w_member_social')) {
    console.error(`token is active but cannot post — scopes: ${scopes.join(', ') || '(none)'}`);
    console.error('Re-mint it with `w_member_social`, `profile` and `openid` ticked.');
    return 1;
  }

  if (!t.active) {
    console.error(`token is ${t.status || 'not active'} — nothing can be posted until it is replaced.`);
    console.error('Mint a new one at https://www.linkedin.com/developers/tools/oauth/token-generator');
    console.error('with the same three scopes, and update the LINKEDIN_ACCESS_TOKEN secret.');
    return 1;
  }

  const days = Math.floor((t.expires_at * 1000 - Date.now()) / 86400000);
  console.log(`token active · ${days} day(s) left · scopes: ${scopes.join(', ')}`);
  if (days <= WARN_DAYS) {
    console.log(`WARN  under ${WARN_DAYS} days left. Renew it before it takes a post down with it:`);
    console.log('      https://www.linkedin.com/developers/tools/oauth/token-generator');
    return 2;   // distinct from 0 so a workflow can annotate without failing
  }
  return 0;
}

if (args.includes('--check-token')) process.exit(await checkToken());

/* ───────── run ───────── */

const all = queue();
const pending = all.filter(p => force || !ledger.posts[p.slug]);

if (!all.length) {
  console.log(only
    ? `no post matched --only ${only} (is it published, and does it have \`linkedin: true\`?)`
    : 'no posts carry `linkedin: true` — nothing to post.');
  process.exit(0);
}
if (!pending.length) {
  console.log(`${all.length} post(s) carry \`linkedin: true\`, and all are already on LinkedIn:`);
  for (const p of all) console.log(`  /blog/${p.slug}/  ${ledger.posts[p.slug].url}`);
  console.log('\n--force posts one again, which duplicates it on the feed.');
  process.exit(0);
}

/* Shown in both modes: --publish prints exactly what a dry run printed, so the
   confirmation is over text that has already been read once. A post to a
   personal feed cannot be quietly fixed afterwards. */
const quota = quotaOf(Object.values(ledger.posts).map(p => p.postedAt));
const cap   = limit === undefined ? quota.cap : Number(limit);
if (limit === undefined) console.log(`cap ${cap} — ${quota.why}`);
else console.log(`cap ${cap} (--limit, overriding: ${quota.why})`);

const going = pending.slice(0, cap);
const held  = pending.length - going.length;

for (const p of going) {
  console.log(`\n/blog/${p.slug}/  →  ${p.url}`);
  console.log(`  rank    ${p.rank} — ${p.why}`);
  console.log(`  card    ${p.meta.title}`);
  console.log(`  image   ${noThumb ? '(none)' : path.relative(ROOT, THUMBNAIL)}`);
  console.log(`  text    ${p.text.length}/${MAX_COMMENTARY} characters`);
  console.log('  ──────');
  console.log(readable(p.text).split('\n').map(l => `  │ ${l}`).join('\n'));
  console.log('  ──────');
  if (showJson) console.log(JSON.stringify(articlePost(p, 'urn:li:person:YOU', 'urn:li:image:THUMB'), null, 2)
    .split('\n').map(l => `  ${l}`).join('\n'));
  if (p.text.length > MAX_COMMENTARY)
    console.log(`  ERROR   ${p.text.length - MAX_COMMENTARY} characters over LinkedIn's limit — shorten \`linkedinText\`.`);
  if (!p.meta.linkedinText && !p.meta.description)
    console.log('  WARN    no `linkedinText` and no `description` — this post is its title and a link.');
  const links = autolinks(p.text);
  if (links.length)
    console.log(`  ERROR   LinkedIn would turn ${links.join(', ')} into a link to a dead host. Rewrite without the dot.`);
}

if (held) {
  /* A feed slot is the scarcest thing here — three a week against a site that
     publishes up to sixty a month — so this is a selection and saying "waiting"
     would be a promise the budget cannot keep. Every run re-ranks the whole
     list, so the best subject wins each slot no matter when it was written. */
  console.log(`\n${held} below the cut, lowest rank last: ` +
    pending.slice(cap).map(p => `${p.slug} (${p.rank})`).join(', '));
  console.log('Not a queue. Each run picks the best subject still unannounced, so one of these goes');
  console.log(`out when nothing better is waiting. --limit ${pending.length} would post them all now, which reads as a bot.`);
}

if (!publish) {
  console.log('\nDry run. Re-run with --publish to post. LINKEDIN_ACCESS_TOKEN must be set.');
  process.exit(0);
}

const over = going.filter(p => p.text.length > MAX_COMMENTARY);
if (over.length) {
  console.error(`\n${over.length} post(s) exceed LinkedIn's ${MAX_COMMENTARY}-character limit. Nothing was posted.`);
  process.exit(1);
}

/* Refused rather than warned about. A warning on a step nobody watches is how
   the first one shipped, and the damage is public and permanent-ish: the
   commentary can be patched afterwards, but only by hand, and only after
   somebody has already read it. */
const linky = going.filter(p => autolinks(p.text).length);
if (linky.length) {
  console.error('\nLinkedIn would publish these as links to hosts that do not exist:');
  for (const p of linky) console.error(`  ${p.slug}: ${autolinks(p.text).join(', ')}`);
  console.error('Rewrite them without the dot — "a mainTemplate gradle file" rather than');
  console.error('"mainTemplate.gradle". Nothing was posted.');
  process.exit(1);
}

if (!TOKEN) {
  console.error('\nLINKEDIN_ACCESS_TOKEN is not set.');
  console.error('Mint one at https://www.linkedin.com/developers/tools/oauth/token-generator');
  console.error('with the `w_member_social` and `profile` scopes.');
  process.exit(1);
}

/* Publishing to a public feed is not undoable from here — the API can delete a
   post, but the people who saw it still saw it. So it asks, and a non-interactive
   run has to say --yes rather than have the answer assumed for it. */
if (!yes) {
  if (!process.stdin.isTTY) {
    console.error('\nNot a terminal, so there is nobody to ask. Re-run with --yes if this is deliberate.');
    process.exit(1);
  }
  if (!await ask(`\npost the ${going.length} above to LinkedIn? [y/N] `)) process.exit(0);
}

const { urn: owner, name } = await author();
console.log(`\nposting as ${name ? `${name} ` : ''}${owner}`);

let image = null;
try {
  image = await thumbnail(owner);
} catch (e) {
  /* A token scoped only to `w_member_social` cannot read images back, so there
     is no way to check an upload short of using it. Losing the card image is a
     smaller loss than losing the post, so this degrades rather than stops. */
  console.log(`  thumbnail upload failed (${e.message.split('\n')[0]}) — posting without the image`);
}

let posted = 0;
for (const p of going) {
  let res;
  try {
    ({ res } = await api('POST', '/rest/posts', articlePost(p, owner, image)));
  } catch (e) {
    if (!image) throw e;
    /* The image URN is used the moment it is uploaded, and LinkedIn processes
       it asynchronously. If that is what the rejection is about, the post
       itself is still fine without it. */
    console.log(`  ${p.slug}: rejected with the image (${e.message.split('\n')[0]})`);
    console.log('  retrying without the link-card image');
    image = null;
    ({ res } = await api('POST', '/rest/posts', articlePost(p, owner, null)));
  }

  const urn = res.headers.get('x-restli-id');
  const url = urn ? `https://www.linkedin.com/feed/update/${urn}/` : '(URN not returned)';
  ledger.posts[p.slug] = { urn, url, postedAt: TODAY };
  writeLedger(ledger);
  posted++;
  console.log(`posted   /blog/${p.slug}/  →  ${url}`);
}

console.log(`\n${posted} posted.`);
console.log(`${path.relative(ROOT, LEDGER)} records them — commit it on a branch, as anything else here.`);
if (held) console.log(`${held} still waiting. Run this again tomorrow rather than raising the cap.`);
