#!/usr/bin/env node
/**
 * Generates the index page for the public snippet hub.
 *
 * The ten gists have no home page. Each one is findable only if you already
 * know it exists, and every link out of them is rel="nofollow" because that is
 * how GitHub renders user markdown. A page on GitHub Pages is ordinary HTML
 * that we write, so its links are followed.
 *
 * Two things this is NOT, both deliberate:
 *
 *   - It is not a copy of the posts. A third copy of the same prose — post,
 *     gist README, hub — would compete with the original for the same queries
 *     and is worth less than the one link it would carry. Every entry here is
 *     a title, a sentence, and two links out.
 *   - It is not published from this repo. This repo is private and owned under
 *     a real name; the gists are published under IndieCoreDev, and
 *     build-gist.mjs strips every identifying string to keep those two apart.
 *     Serving Pages from here would undo that in one commit. sync-hub.yml
 *     pushes the output to a public repo on the IndieCoreDev account instead.
 *
 * Output is committed, so a change is reviewable in a PR rather than appearing
 * only on the live page.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT  = path.join(ROOT, 'hub');
const SITE = 'https://www.indiecore.net';

/* The account the hub is published under, and the page it serves at. Changing
   either means changing the repo on GitHub in the same breath — Pages serves
   whatever the repo is named, and nothing here can check that for you. */
export const HUB_REPO = 'IndieCoreDev/IndieCoreDev.github.io';
const HUB_URL = 'https://indiecoredev.github.io/';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Same guard as build-gist.mjs, minus the domain: the whole point of this page
   is to link indiecore.net. Everything else that identifies a person still
   must not appear — the hub sits on the anonymous account, next to the gists,
   and one stray string joins the two together permanently. */
const LEAKS = ['oettaib', 'indiecode25', 'Othmane', 'Ettaib', '943 647', 'Bretagne'];

const post = slug => {
  const raw = fs.readFileSync(path.join(ROOT, 'content/blog', `${slug}.md`), 'utf8');
  const field = k => raw.match(new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm'))?.[1].replace(/^["']|["']$/g, '');
  return { slug, title: field('title'), description: field('description'), code: field('code'), url: `${SITE}/blog/${slug}/` };
};

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'gist/gists.json'), 'utf8'));

const entries = manifest.map(g => {
  const posts = (g.posts ?? [g.post]).map(post);
  const files = fs.readdirSync(path.join(ROOT, 'gist', g.dir))
    .filter(f => f !== '0-README.md')
    .sort();
  /* The gist URL is only knowable after sync-gist.yml has run and someone has
     pasted it into the post's `code:` field. Until then the entry still lists
     the post — a card with one link is better than no card. */
  return { ...g, posts, files, gist: posts.find(p => p.code)?.code };
});

const missing = entries.filter(e => !e.gist);
if (missing.length) {
  console.warn(`  warn  no gist URL yet for: ${missing.map(e => e.dir).join(', ')}`);
  console.warn('        add it to the post\'s `code:` field once sync-gist.yml has published it.');
}

const card = e => `      <li class="card">
        <h2>${esc(e.marker)}</h2>
        <p>${esc(e.posts[0].description ?? '')}</p>
        <p class="files">${e.files.map(f => `<code>${esc(f)}</code>`).join(' ')}</p>
        <p class="links">
          ${e.gist ? `<a href="${esc(e.gist)}">Read the code</a>` : ''}
          ${e.posts.map(p => `<a href="${esc(p.url)}">${esc(p.title)}</a>`).join('\n          ')}
        </p>
      </li>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IndieCore — code from the posts</title>
<meta name="description" content="Ten gists generated from the code that actually runs, each one written up in full on indiecore.net.">
<link rel="canonical" href="${HUB_URL}">
<style>
  :root { color-scheme: light dark; --bg:#fbfbfa; --fg:#1a1a19; --dim:#5c5c58; --line:#e3e3df; --card:#fff; --link:#1d4ed8; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#e8e8e5; --dim:#a0a09a; --line:#2c2c2a; --card:#1c1c1b; --link:#93b4ff; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
  h1 { font-size: 1.75rem; line-height:1.25; margin:0 0 .5rem; }
  .lede { color: var(--dim); margin: 0 0 2.5rem; }
  ul { list-style:none; margin:0; padding:0; display:grid; gap:1rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1.1rem 1.25rem; }
  .card h2 { font-size:1.05rem; line-height:1.35; margin:0 0 .4rem; }
  .card p { margin:0 0 .55rem; }
  .files { font-size:.8rem; color:var(--dim); }
  .files code { background:color-mix(in srgb, var(--fg) 7%, transparent); padding:.1rem .35rem; border-radius:4px; }
  .links { display:flex; flex-wrap:wrap; gap:.4rem 1rem; margin:0; font-size:.9rem; }
  a { color:var(--link); }
  footer { margin-top:3rem; padding-top:1.5rem; border-top:1px solid var(--line); color:var(--dim); font-size:.9rem; }
</style>
</head>
<body>
  <main class="wrap">
    <h1>Code from the posts</h1>
    <p class="lede">Each of these is generated from the file that actually runs — not pasted from
      it — so a snippet here cannot drift from the thing it was taken out of. Every one is
      written up in full on <a href="${SITE}/blog/">indiecore.net</a>.</p>
    <ul>
${entries.map(card).join('\n')}
    </ul>
    <footer>
      <p>Published from the same repository that generates them. The write-ups live at
        <a href="${SITE}/blog/">indiecore.net/blog</a>.</p>
    </footer>
  </main>
</body>
</html>
`;

/* The repo's own front page. Its links are nofollow like everything else
   GitHub renders, so this is for the person who lands on the repo rather than
   the page — it exists so the repository does not look abandoned. */
const readme = `# Code from the posts

The snippets behind the write-ups at [indiecore.net](${SITE}/blog/), each one generated from
the file that actually runs rather than pasted from it.

**Browse them at [${HUB_URL.replace(/^https:\/\//, '').replace(/\/$/, '')}](${HUB_URL})** — that
page indexes every gist on this account alongside the post that explains it.

Generated and published automatically. Opening a pull request here will not do much; the
source lives with the code it is taken from.
`;

const leaked = LEAKS.filter(l => (html + readme).toLowerCase().includes(l.toLowerCase()));
if (leaked.length) {
  console.error('refusing to write hub/ — identifying content found:');
  leaked.forEach(l => console.error(`  "${l}"`));
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.writeFileSync(path.join(OUT, 'README.md'), readme);
console.log(`hub/index.html — ${entries.length} entries, ${(html.length / 1024).toFixed(1)} KB`);
console.log(`hub/README.md  — ${(readme.length / 1024).toFixed(1)} KB`);
console.log(`publishes to ${HUB_REPO} → ${HUB_URL}`);
