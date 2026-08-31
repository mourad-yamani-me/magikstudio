#!/usr/bin/env node
/**
 * Generates each public gist's files from the real config, so a published
 * snippet can never drift from what this repo actually runs.
 *
 * One subdirectory per gist: gist/<dir>/. The workflow publishes each one to
 * its own gist, found by the `marker` description rather than a stored ID.
 * Output is committed, so changes are reviewable in a PR.
 *
 * Adding a gist for a new post: append an entry to GISTS below. The `post`
 * slug is checked — the build refuses to run if the post it links to is
 * missing or still a draft, so a gist can never advertise a dead URL.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT  = path.join(ROOT, 'gist');
const SITE = 'https://www.indiecore.net';

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* Pulls one marked region out of a real source file, so a gist can publish the
   interesting 60 lines of an 1800-line generator without anyone copying them.
   The markers are comments in the source and are stripped from the output:

     /* gist:image-pipeline *\/   …code…   /* /gist:image-pipeline *\/

   A missing marker fails the build rather than publishing an empty file — the
   region moving or being renamed is exactly the drift this is here to stop. */
function section(file, name) {
  const src = read(file);
  const open  = new RegExp(`(?:/\\*|//)\\s*gist:${name}\\s*(?:\\*/)?[^\\n]*\\n`);
  const close = new RegExp(`[^\\n]*(?:/\\*|//)\\s*/gist:${name}\\s*(?:\\*/)?`);
  const a = src.match(open);
  if (!a) { console.error(`refusing to build: ${file} has no "gist:${name}" marker`); process.exit(1); }
  const rest = src.slice(a.index + a[0].length);
  const b = rest.match(close);
  if (!b) { console.error(`refusing to build: ${file} has no "/gist:${name}" marker`); process.exit(1); }
  const body = rest.slice(0, b.index).replace(/\s+$/, '');
  if (!body.trim()) { console.error(`refusing to build: ${file} region "${name}" is empty`); process.exit(1); }
  return body + '\n';
}

/* A post's URL is derived from its filename, so it is knowable before either
   exists — but that also means renaming the post would silently break the
   link. Resolve it from the file instead of hardcoding. */
function backlink(slug) {
  const file = path.join(ROOT, 'content/blog', `${slug}.md`);
  if (!fs.existsSync(file)) {
    console.error(`refusing to build: a gist links to /blog/${slug}/,`);
    console.error(`but content/blog/${slug}.md does not exist.`);
    process.exit(1);
  }
  if (/^draft:\s*true\s*$/m.test(fs.readFileSync(file, 'utf8'))) {
    console.error(`refusing to build: content/blog/${slug}.md is a draft,`);
    console.error('so the gist would link to a page that is never published.');
    process.exit(1);
  }
  return `${SITE}/blog/${slug}/`;
}

/** strip anything identifying: project name, domain, account handles */
const sanitize = str => str
  .replace(/indie-core-dev/g, 'my-site')
  .replace(/www\.indiecore\.net/g, 'www.example.com')
  .replace(/"indiecore\.net"/g, '"example.com"')
  .replace(/https:\/\/www\.indiecore\.net/g, 'https://www.example.com')
  // the form-action chain lists the apex as well as www; without this the
  // real domain shipped in the published gist for months
  .replace(/https:\/\/indiecore\.net/g, 'https://example.com')
  .replace(/github\.com\/oettaib/g, 'github.com/YOUR-USERNAME')
  // verify.mjs asserts that the legal pages still carry the real identity, so the
  // published copy has to carry placeholders instead. Without these the leak guard
  // below refuses the whole build — which is how this was noticed.
  .replace(/Othmane Ettaib/g, 'Your Name')
  .replace(/943\\s\*647\\s\*503/g, '000\\s*000\\s*000')
  .replace(/943 647 503/g, '000 000 000')
  .replace(/\b94000\b/g, '00000');

/* ─────────────────────────── the gists ─────────────────────────── */

const GISTS = [{
  dir: 'cloudflare-workers',
  // Must not change: the workflow finds the existing gist by this string.
  marker: 'Static site → Cloudflare Workers with gated GitHub Actions deploys',
  post: 'static-site-cloudflare-workers',
  files: () => ({
    'wrangler.jsonc': sanitize(read('wrangler.jsonc')),
    'ci-cd.yml':      sanitize(read('.github/workflows/ci-cd.yml')),
  }),
  readme: url => `# Static site → Cloudflare Workers, with gated deploys

A GitHub Actions pipeline that builds a static site, refuses to ship it if the checks fail,
and deploys it to Cloudflare Workers. Free tier throughout.

\`\`\`
git push
   └─ build ──► verify ──► Lighthouse budget ──► deploy
\`\`\`

\`deploy\` depends on the checks, so nothing broken reaches the internet. Pull requests get a
preview URL posted as a comment; merges to \`main\` go to production.

## Files

| File | What it is |
| --- | --- |
| \`wrangler.jsonc\` | The Worker: static assets, custom domains, 404 handling |
| \`ci-cd.yml\` | Goes in \`.github/workflows/\` |

## Setup

1. Create a Worker: **Workers & Pages → Create → Workers → Upload assets**, name it, drag
   your build output in once to create the project.
2. Create an API token from the **"Edit Cloudflare Workers"** template — not a custom one,
   and not the Global API Key. Scope it to your account and zone.
3. Add repository secrets \`CLOUDFLARE_API_TOKEN\` and \`CLOUDFLARE_ACCOUNT_ID\`.
4. Create \`production\` and \`preview\` environments; restrict \`production\` to \`main\`.
5. Replace \`my-site\` and \`example.com\` throughout, then push.

## Things that will bite you

- **\`workers_dev\` and \`preview_urls\` must be set explicitly.** Absent from the config means
  *disabled*, which silently takes your \`*.workers.dev\` URL offline and stops preview URLs
  being generated.
- **Custom domains belong in \`routes\`, not the dashboard.** The dashboard dialog matches zone
  names rather than hostnames, so a subdomain can't be selected there.
- **Attaching a custom domain fails while an old DNS record exists** for that hostname —
  \`already has externally managed DNS records [code: 100117]\`. Delete the old record first.
- **Don't connect a Git repository in the Worker's settings** if you use this workflow. That
  enables Cloudflare's own builds, and two pipelines then race to publish the same site — one
  of them without any checks.
- **Non-overlapping \`_headers\` rules.** Every matching rule is applied and the values are
  joined, so a broad \`/assets/*\` beside \`/assets/images/*\` produces a \`Cache-Control\` with
  two \`max-age\` values. Browsers take the first.

## Not included

\`scripts/verify.mjs\` and \`scripts/lighthouse-check.mjs\` are referenced by the workflow but
are specific to each site. There is a companion gist for those — linked from the post below.

---

Written up in full here: **${url}**

_Generated from the live configuration — see the post for context._
`,
}, {
  dir: 'build-gates',
  marker: 'Build gates for a static site — output verification and a Lighthouse budget',
  post: 'build-reviews-ai-code',
  files: () => ({
    'verify.mjs':           sanitize(read('scripts/verify.mjs')),
    'lighthouse-check.mjs': sanitize(read('scripts/lighthouse-check.mjs')),
  }),
  readme: url => `# Build gates for a static site

Two dependency-free Node scripts that decide whether a build is allowed to ship. Run them
after your generator writes its output; wire them into CI so the deploy job depends on them.

\`\`\`
npm run build && node verify.mjs && node lighthouse-check.mjs
\`\`\`

Both exit non-zero on failure, which is the whole interface.

## Files

| File | What it does |
| --- | --- |
| \`verify.mjs\` | Walks the built output and fails on anything that must never ship |
| \`lighthouse-check.mjs\` | Fails if performance, accessibility, best-practices or SEO drop below budget |

## What verify.mjs checks

Every rule is here because something got past a review, not because a style guide recommends
it. Adapt the list; the shape is the point.

- **Head essentials** — \`<title>\`, meta description, an absolute canonical, an \`og:image\`
  that exists on disk. Warns when title or description will truncate in results.
- **Structure** — exactly one \`<h1>\` per page.
- **Links and images** — every site-absolute \`href\`, \`src\` and \`srcset\` candidate resolves to
  a real file. Every \`<img>\` has \`alt\`; missing \`width\`/\`height\` warns.
- **\`target="_blank"\`** without \`rel="noopener"\`.
- **Content hygiene** — double-escaped entities, placeholder copy, markup left over from a
  platform migration.
- **Redirects** — every target resolves, and every rule is a 301.
- **Sitemap** — canonical host, no dead URLs, and every built page is listed.

## What lighthouse-check.mjs does

Runs Lighthouse against a sample of URLs and fails the build below budget:

\`\`\`
performance ≥ 90, accessibility ≥ 100, best-practices ≥ 100, seo ≥ 100
\`\`\`

The one non-obvious part: **performance is re-measured when it misses, and the median is
taken.** Shared CI runners are noisy, and a gate that fails at random gets ignored, then
disabled, then deleted. Only performance is retried — the other categories are deterministic.

Override per-run with \`LH_BUDGET\`, e.g. \`LH_BUDGET='{"performance":80}'\`.

## Worth knowing

Write the failure messages for whoever — or whatever — has to fix them:

\`\`\`
  ERROR  /blog/index.html: dead internal link → /games/word-slot
\`\`\`

A message that names the page, the problem and the offending value can be handed straight to
a coding agent and fixed in one pass. "Validation failed" starts a conversation instead.

---

Written up in full here: **${url}**

_Generated from the live scripts — see the post for context._
`,
}, {
  dir: 'responsive-images',
  marker: 'Responsive image pipeline — Chrome\'s byte budget, measured sizes, one cache',
  post: 'lighthouse-image-budget',
  files: () => ({
    'image-pipeline.mjs':    sanitize(section('build.mjs', 'image-pipeline')),
    'responsive-markup.mjs': sanitize(section('build.mjs', 'responsive-markup')),
  }),
  readme: url => `# Responsive images that satisfy Chrome's actual budget

Two pieces of a static site generator. One encodes every derivative and holds it under the
byte budget Lighthouse measures against; the other writes the \`<picture>\` markup that
decides which of them a browser downloads.

\`\`\`
source.jpg ──► 200w / 320w / … WebP ──► <picture> with a sizes string
                    │
                    └─ each one under w × h ÷ 6 bytes
\`\`\`

## The constant

Lighthouse's *Improve image delivery* insight reports both a file's size and the bytes it
considers wasted on compression. Subtract one from the other and the target it has in mind is
**one sixth of a byte per pixel**, every time — a 256×256 icon: 65536 ÷ (18804 − 7881) =
6.0000. Savings under 4 KiB are not reported, which is why some files sit over the line and
stay quiet.

\`ceiling()\` computes it. \`encodeWebp()\` re-encodes with \`cwebp -size\` only when a file
overshoots.

**Treat it as a ceiling, never a target.** Most images land far under it — one 400px
screenshot here is 21 KB against a 47 KB ceiling — and encoding everything *to* the budget
would double them.

## Files

| File | What it does |
| --- | --- |
| \`image-pipeline.mjs\` | Encodes the derivatives, content-addressed so nothing re-encodes twice |
| \`responsive-markup.mjs\` | Rewrites \`<img>\` into \`<picture>\` with srcset, sizes and dimensions |

## Worth knowing

- **The cache key includes the encoder flags.** Change quality or method and every key
  changes, so old output is never replayed as though it had been made with the new settings.
  Without that, a warm cache silently serves you the previous encoder's work.
- **\`sizes\` is a claim about layout, and it is easy to get wrong.** Every value in the markup
  file was measured against the rendered page, not estimated. One string covering two
  different layouts is right for neither: the same screenshot renders at a constant 254px in a
  carousel and at 116px in a five-across grid on a tablet.
- **One attribute per layout.** A marker that means two things — a hero on one template and a
  carousel on another — will size one of them for the other's box.
- **Method 6 with \`-sharp_yuv\` is smaller *and* sharper** than the default at a lower quality
  number. It is slow, which is what the cache is for.
- **The second half of the insight is geometry, not compression.** Its waste figure is
  \`bytes × (1 − displayedPx ÷ intrinsicPx)\`, which reaches zero only when the file has as
  many pixels as the CSS box. That is a 1× image, and it will look soft on any modern phone.

---

Written up in full here: **${url}**

_Generated from the live generator — see the post for context._
`,
}, {
  dir: 'accessible-lightbox',
  marker: 'Accessible image lightbox — focus trap, restore, and the visibility trap',
  post: 'opacity-zero-is-not-hidden',
  files: () => ({
    'lightbox.js':  sanitize(section('src/app.js', 'lightbox-js')),
    'lightbox.css': sanitize(section('src/styles.css', 'lightbox-css')),
  }),
  readme: url => `# An image lightbox that behaves for keyboard users

No dependencies. Attaches to any container marked \`data-lightbox\` containing \`.shot\`
buttons, builds the dialog once, and gets the keyboard contract right.

\`\`\`html
<div data-lightbox>
  <button class="shot" data-i="0"><span class="scr"><img src="…" data-full="…"></span></button>
</div>
\`\`\`

## The bug this exists because of

The obvious way to hide an overlay does not hide it:

\`\`\`css
.lb      { opacity: 0; pointer-events: none }
.lb.open { opacity: 1; pointer-events: auto }
\`\`\`

That covers the mouse and nothing else. The element keeps its layout box, stays in the
accessibility tree, and its buttons stay in the tab order — so a keyboard user tabs into
Previous, Next and Close on a dialog that is not on screen. \`visibility: hidden\` is what
actually removes it.

## Then the part that catches you

\`focus()\` on a \`visibility: hidden\` element does nothing. No error, no warning, and
\`document.activeElement\` is unchanged. So this looks correct and is not:

\`\`\`js
lb.classList.add('open');
lb.querySelector('.lb-close').focus();   // dropped, if .open has not applied yet
\`\`\`

With \`transition: opacity .3s, visibility .3s\` the computed value stays \`hidden\` until the
transition starts on the next frame. Forcing a reflow does not help. Give visibility a zero
duration and delay it only on the way out:

\`\`\`css
.lb      { visibility: hidden;  transition: opacity .3s, visibility 0s .3s }
.lb.open { visibility: visible; transition: opacity .3s, visibility 0s 0s }
\`\`\`

Now it flips in the same tick, the focus lands, and the fade still finishes before the dialog
disappears.

## What the JS handles

- \`role="dialog"\`, \`aria-modal\`, and a label — \`aria-modal\` tells assistive technology to
  ignore the page behind, but does **not** stop Tab walking into it, so the trap is still
  yours to write
- Focus moves to Close on open and returns to the thumbnail that opened it on close
- Tab and Shift+Tab cycle within the dialog
- Escape closes; arrow keys move between images
- \`data-full\` so the dialog can open a WebP rather than the \`<img>\` \`src\`, which is the
  fallback JPEG and roughly three times the size

## Test it by pressing the keys

Reading the code will not find either bug above, because the code says the right thing both
times. Dispatch real \`Tab\` and \`Escape\` events and print \`document.activeElement\` after each.
The contract is visible as output: focus enters, cycles without escaping, returns to the
opener.

---

Written up in full here: **${url}**

_Generated from the live scripts — see the post for context._
`,
}];

/* ─────────────────────────── build ─────────────────────────── */

/* guard: never publish anything identifying */
const LEAKS = ['indiecore.net', 'oettaib', 'indiecode25', 'Othmane', 'Ettaib', '943 647', 'Bretagne'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const manifest = [];

for (const g of GISTS) {
  const url   = backlink(g.post);
  const files = { '0-README.md': g.readme(url), ...g.files() };
  const dir   = path.join(OUT, g.dir);

  for (const [name, content] of Object.entries(files)) {
    for (const leak of LEAKS) {
      // the one permitted mention is the link back to the post
      if (leak === 'indiecore.net' && name === '0-README.md') continue;
      if (content.toLowerCase().includes(leak.toLowerCase())) problems.push(`${g.dir}/${name}: "${leak}"`);
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  manifest.push({ dir: g.dir, marker: g.marker, post: g.post });

  console.log(`gist/${g.dir}/ — ${Object.keys(files).length} files`);
  for (const [n, c] of Object.entries(files)) console.log(`  ${n}  ${(c.length / 1024).toFixed(1)} KB`);
}

if (problems.length) {
  console.error('refusing to write gist files — identifying content found:');
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}

// The workflow reads this to know which directory publishes to which gist.
// It lives above the per-gist directories, so it is never itself published.
fs.writeFileSync(path.join(OUT, 'gists.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${manifest.length} gist(s) written.`);
