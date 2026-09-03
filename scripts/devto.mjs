#!/usr/bin/env node
/**
 * Cross-posts a blog post to dev.to, canonicalised back to this site.
 *
 * Why dev.to and not the other places a post could go: its rendered article
 * carries `<link rel="canonical">` pointing at the original, and it does not
 * add `rel="nofollow"` to an outbound link. Both were checked against live
 * articles before this script was written — 20 of 20 canonical tags pointed
 * off-site, and 129 of 130 outbound links in the body were followed. The
 * reddit/HN/lobsters class of site gives neither, which is why nothing here
 * tries to post to them.
 *
 * The canonical tag is the part that matters most. Without it the copy on
 * dev.to competes with the original for the same query and can outrank it,
 * which is a worse outcome than not posting at all.
 *
 *   node scripts/devto.mjs                  # dry run: what would be sent
 *   node scripts/devto.mjs --publish        # create/update, published live
 *   node scripts/devto.mjs --publish --draft  # create/update, left unpublished
 *   node scripts/devto.mjs --only <slug>    # one post
 *
 * Opt in per post with `devto: true` in the frontmatter. Nothing is sent for a
 * post that does not carry it, and nothing is ever sent for a draft.
 *
 * Idempotent: articles are matched by their canonical_url, so a second run
 * updates the article it made the first time instead of posting a duplicate.
 * The API can unpublish an article (PUT /articles/{id}/unpublish) but cannot
 * delete one, so a mistaken create is a manual cleanup. --publish asks before
 * it creates anything new.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { GIST_RE, resolveGistEmbed } from './gist-embed.mjs';
import { frontmatter } from './frontmatter.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BLOG = path.join(ROOT, 'content/blog');
const SITE = 'https://www.indiecore.net';
const TODAY = new Date().toISOString().slice(0, 10);   // UTC, same clock as the build
const API  = 'https://dev.to/api';

const args    = process.argv.slice(2);
const publish = args.includes('--publish');
const draft   = args.includes('--draft');
/* indexOf returns -1 when the flag is absent, and args[-1 + 1] is args[0] —
   which under `--publish` reads the flag itself as a slug and silently matches
   no posts. The run then succeeds having published nothing, which is the worst
   shape a bug can take in a workflow nobody watches. */
const limitAt = args.indexOf('--limit');
const limit   = limitAt === -1 ? null : Number(args[limitAt + 1]);
if (limitAt !== -1 && !Number.isInteger(limit)) {
  console.error('--limit needs a whole number after it, e.g. --limit 1');
  process.exit(1);
}

/* Writes each composed body to a file so it can be diffed against what dev.to
   stores. Added while chasing a run that reported every article as updated
   when none had changed — the answer was in the bytes, and guessing at it
   costs more than the flag does. */
const dumpAt  = args.indexOf('--dump');
const dump    = dumpAt === -1 ? null : args[dumpAt + 1];
if (dumpAt !== -1 && (!dump || dump.startsWith('--'))) {
  console.error('--dump needs a directory after it, e.g. --dump /tmp/devto');
  process.exit(1);
}

const onlyAt  = args.indexOf('--only');
const only    = onlyAt === -1 ? undefined : args[onlyAt + 1];
if (onlyAt !== -1 && (!only || only.startsWith('--'))) {
  console.error('--only needs a post slug after it, e.g. --only static-site-cloudflare-workers');
  process.exit(1);
}
const KEY     = process.env.DEVTO_API_KEY;

/* ───────── reading the posts ───────── */

/* dev.to tags are alphanumeric only — `ci-cd` is rejected outright rather than
   slugified for you, which fails the whole request with a validation error.
   Four is the hard maximum. */
const devtoTags = tags => (tags ?? [])
  .map(t => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
  .filter(Boolean)
  .slice(0, 4);

/* The body the site renders and the body dev.to renders differ in three ways,
   all of them mechanical. */
function toDevtoMarkdown(body, meta, slug) {
  const file = `content/blog/${slug}.md`;

  // 1. {{gist:…}} has no meaning off this site. Inline the same lines the site
  //    inlines, as a plain fence with the filename above it.
  let out = body.replace(GIST_RE, (_, name, anchor, from, to) => {
    const { base, content, note, lang } = resolveGistEmbed(name, anchor, from, to, file);
    return ['', `**\`${base}\`**${note}`, '', '```' + lang, content, '```', ''].join('\n');
  });

  // 2. Root-relative links resolve against dev.to once the post is there.
  //    Absolutising them keeps them working and points each one back here.
  out = out.replace(/\]\((\/[^)]*)\)/g, `](${SITE}$1)`);

  // 3. The link that makes the cross-post worth doing. Top, where it is seen;
  //    bottom, where it is copied.
  const url = `${SITE}/blog/${slug}/`;
  const head = `*Originally published on [indiecore.net](${url}).*\n\n`;
  const foot = [
    '', '---', '',
    `Originally published at **[${meta.title}](${url})**.`,
    meta.code ? `\nThe code is on GitHub: [${meta.codeLabel || 'the full source'}](${meta.code})` : '',
    '',
  ].join('\n');

  // 4. The change history the site renders from frontmatter rather than from
  //    the body. Without this the dev.to copy quietly claims the post has
  //    never been revised, which is the one thing a cross-post must not do
  //    differently from the page it is canonical to.
  const changes = (meta.changes || [])
    .map(l => String(l).match(/^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$/))
    .filter(Boolean)
    .sort((a, b) => b[1].localeCompare(a[1]));
  const history = changes.length
    ? ['', '---', '', '## Change history', '',
       ...changes.map(c => `- **${c[1]}** — ${c[2].trim()}`)].join('\n') + '\n'
    : '';

  return head + out.replace(/\s+$/, '') + '\n' + history + foot;
}

function posts() {
  const out = [];
  for (const f of fs.readdirSync(BLOG).filter(f => f.endsWith('.md') && !f.startsWith('_'))) {
    const slug = f.replace(/\.md$/, '');
    if (only && slug !== only) continue;
    const parsed = frontmatter(fs.readFileSync(path.join(BLOG, f), 'utf8'));
    if (!parsed) continue;
    const { meta, body } = parsed;
    if (meta.draft) continue;           // never send something the site itself does not show
    // Same rule for a post whose date has not arrived: the article's canonical
    // points back here, and a canonical that 404s is worse than a late article.
    // The daily schedule picks it up on the first run after the date.
    if (String(meta.date ?? '') > TODAY) continue;
    if (meta.devto !== true) continue;  // opt in, one post at a time
    out.push({
      slug, meta,
      article: {
        title: meta.title,
        body_markdown: toDevtoMarkdown(body, meta, slug),
        published: !draft,
        canonical_url: `${SITE}/blog/${slug}/`,
        description: meta.description ?? '',
        tags: devtoTags(meta.tags),
      },
    });
  }
  return out;
}

/* ───────── the API ───────── */

/* Thrown on 429 so the caller can stop the run rather than fail it. Being
   rate limited is the expected steady state of a drip, not a fault. */
class RateLimited extends Error {
  constructor(seconds) { super(`rate limited, retry in ${seconds}s`); this.seconds = seconds; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, endpoint, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + endpoint, {
      method,
      headers: { 'api-key': KEY, 'content-type': 'application/json', accept: 'application/vnd.forem.api-v1+json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 300;
      /* A short wait is Forem's ordinary throttle — 30s between writes — and is
         worth sitting through once. A long one is the anti-spam limiter, which
         means this run has done its share for now; the schedule picks the rest
         up rather than holding a job open for five minutes. */
      if (wait <= 60 && attempt === 0) {
        console.log(`  rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      throw new RateLimited(wait);
    }

    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}\n${text.slice(0, 600)}`);
    return text ? JSON.parse(text) : null;
  }
}

/** every article on the account, so an existing one can be matched by canonical */
async function mine() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await api('GET', `/articles/me/all?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

const ask = q => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, a => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
});

/* ───────── run ───────── */

const queue = posts();
if (!queue.length) {
  console.log(only
    ? `no post matched --only ${only} (is it published, and does it have \`devto: true\`?)`
    : 'no posts carry `devto: true` — nothing to cross-post.');
  process.exit(0);
}

if (!publish) {
  console.log(`dry run — ${queue.length} post(s) would be sent to dev.to:\n`);
  for (const p of queue) {
    console.log(`  /blog/${p.slug}/`);
    console.log(`    title      ${p.article.title}`);
    console.log(`    canonical  ${p.article.canonical_url}`);
    console.log(`    tags       ${p.article.tags.join(', ') || '(none)'}`);
    console.log(`    body       ${p.article.body_markdown.length} chars`);
    const bad = p.article.body_markdown.match(/\{\{[a-z]+:/g);
    if (bad) console.log(`    WARN       unexpanded shortcodes: ${[...new Set(bad)].join(' ')}`);
    if (dump) {
      fs.mkdirSync(dump, { recursive: true });
      fs.writeFileSync(path.join(dump, `${p.slug}.md`), p.article.body_markdown);
      console.log(`    dumped     ${path.join(dump, `${p.slug}.md`)}`);
    }
  }
  console.log('\nRe-run with --publish to send. DEVTO_API_KEY must be set.');
  process.exit(0);
}

if (!KEY) {
  console.error('DEVTO_API_KEY is not set.');
  console.error('Create one at https://dev.to/settings/extensions → "DEV API Keys".');
  process.exit(1);
}

/* Forem's own limits, read off app/models/settings/rate_limit.rb:

     published_article_creation           9 per 30s
     published_article_antispam_creation  1 per 300s   ← for "new" users
     user_considered_new_days             3

   An account younger than three days may publish one article every five
   minutes, so opting nineteen posts in at once cannot work as one run no
   matter how it is written. Worse than the limit is how it looks: a new
   account posting nineteen articles in a burst, every one canonicalised to the
   same outside domain, is the shape moderators suspend — and a suspension
   costs every link on the account at once.

   So creations drip. Everything can carry `devto: true` from the start; this
   decides how many of them become articles today. Updates are not capped:
   they are cheap, they are not the spam signal, and holding back an edit to an
   article that already exists helps nobody. */
const NEW_ACCOUNT_DAYS = 3;
const me = await api('GET', '/users/me');
const ageDays = (Date.now() - new Date(me.joined_at).getTime()) / 86400000;
const isNew = Number.isFinite(ageDays) && ageDays < NEW_ACCOUNT_DAYS;
const cap = limit ?? (isNew ? 1 : 3);

console.log(`account @${me.username}, joined ${me.joined_at}` +
  (isNew ? ` — under ${NEW_ACCOUNT_DAYS} days old, so dev.to allows one new article per 5 minutes` : ''));

const existing = await mine();
const byCanonical = new Map(existing.filter(a => a.canonical_url).map(a => [a.canonical_url, a]));

/* An article whose stored markdown already matches what we would send needs no
   request. Without this every run would rewrite all of them, which burns the
   update limit and fills the account's history with edits that changed
   nothing. The listing does not carry body_markdown, so it is fetched per
   candidate — cheap next to a write, and only for articles that exist. */
/* dev.to labels an unlabelled fence itself, and not with a fixed value — it
   detects the language, storing ```conf or ```http where we sent a bare ```.
   Compared literally an article can therefore never look unchanged, and every
   scheduled run rewrites all of them: the first run after the drip shipped
   reported nineteen updates when nothing had changed. Blanking the info string
   on both sides is what makes this mean "the code and prose are the same".

   The cost is that changing only a fence's language stops counting as a
   change. That is the better trade: the alternative is sending ```plaintext
   ourselves to force an exact match, which suppresses the detection and loses
   the syntax highlighting on every unlabelled block. */
const fenceBlind = md => md.replace(/^(\s*)(`{3,}|~{3,}).*$/gm, '$1$2');

async function unchanged(p, found) {
  const full = await api('GET', `/articles/${found.id}`);
  return fenceBlind(full.body_markdown ?? '') === fenceBlind(p.article.body_markdown)
      && full.title === p.article.title
      && (full.canonical_url ?? '') === p.article.canonical_url;
}

const creating = queue.filter(p => !byCanonical.has(p.article.canonical_url));
if (creating.length && process.stdin.isTTY) {
  console.log(`about to create ${Math.min(creating.length, cap)} new dev.to article(s):`);
  creating.slice(0, cap).forEach(p => console.log(`  - ${p.article.title}`));
  console.log('The API can unpublish but not delete — removing one afterwards is a manual job.');
  if (!await ask('create them? [y/N] ')) process.exit(0);
}

let created = 0, updated = 0, skipped = 0, held = 0;

try {
  for (const p of queue) {
    const found = byCanonical.get(p.article.canonical_url);

    if (found) {
      if (await unchanged(p, found)) { skipped++; continue; }
      const res = await api('PUT', `/articles/${found.id}`, { article: p.article });
      updated++;
      console.log(`updated  ${res.url}`);
      continue;
    }

    if (created >= cap) { held++; continue; }
    const res = await api('POST', '/articles', { article: p.article });
    created++;
    console.log(`created  ${res.url}`);
  }
} catch (err) {
  if (!(err instanceof RateLimited)) throw err;
  /* Expected, and self-healing: the scheduled run picks up where this stopped.
     Exiting 0 keeps a normal drip from showing as a broken workflow. */
  console.log(`\nstopped early — ${err.message}. The next scheduled run continues.`);
}

const heldNote = held ? `, ${held} held for a later run (cap ${cap})` : '';
console.log(`\n${created} created, ${updated} updated, ${skipped} unchanged${heldNote}`);
if (held) console.log('Raise the cap with --limit N, or let the daily schedule work through them.');
