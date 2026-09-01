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

const ROOT = path.resolve(import.meta.dirname, '..');
const BLOG = path.join(ROOT, 'content/blog');
const SITE = 'https://www.indiecore.net';
const API  = 'https://dev.to/api';

const args    = process.argv.slice(2);
const publish = args.includes('--publish');
const draft   = args.includes('--draft');
const only    = args[args.indexOf('--only') + 1];
const KEY     = process.env.DEVTO_API_KEY;

/* ───────── reading the posts ───────── */

/** minimal frontmatter, the same shape build.mjs parses */
function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim().replace(/^["']|["']$/g, '');
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else if (v === 'true' || v === 'false') {
      meta[k] = v === 'true';
    } else meta[k] = v;
  }
  return { meta, body: m[2] };
}

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

  return head + out.replace(/\s+$/, '') + '\n' + foot;
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

async function api(method, endpoint, body) {
  const res = await fetch(API + endpoint, {
    method,
    headers: { 'api-key': KEY, 'content-type': 'application/json', accept: 'application/vnd.forem.api-v1+json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
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
  }
  console.log('\nRe-run with --publish to send. DEVTO_API_KEY must be set.');
  process.exit(0);
}

if (!KEY) {
  console.error('DEVTO_API_KEY is not set.');
  console.error('Create one at https://dev.to/settings/extensions → "DEV API Keys".');
  process.exit(1);
}

const existing = await mine();
const byCanonical = new Map(existing.filter(a => a.canonical_url).map(a => [a.canonical_url, a]));

const creating = queue.filter(p => !byCanonical.has(p.article.canonical_url));
if (creating.length && process.stdin.isTTY) {
  console.log(`about to create ${creating.length} new dev.to article(s):`);
  creating.forEach(p => console.log(`  - ${p.article.title}`));
  console.log('The API can unpublish but not delete — removing one afterwards is a manual job.');
  if (!await ask('create them? [y/N] ')) process.exit(0);
}

for (const p of queue) {
  const found = byCanonical.get(p.article.canonical_url);
  const res = found
    ? await api('PUT', `/articles/${found.id}`, { article: p.article })
    : await api('POST', '/articles', { article: p.article });
  console.log(`${found ? 'updated' : 'created'}  ${res.url}`);
}
