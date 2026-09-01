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
   link. Resolve it from the file instead of hardcoding.

   The title comes out of the same file, because it is the anchor text of the
   one link a reader is invited to copy. A bare URL as anchor text tells the
   next person nothing about what they are linking to. */
function backlink(slug) {
  const file = path.join(ROOT, 'content/blog', `${slug}.md`);
  if (!fs.existsSync(file)) {
    console.error(`refusing to build: a gist links to /blog/${slug}/,`);
    console.error(`but content/blog/${slug}.md does not exist.`);
    process.exit(1);
  }
  const src = fs.readFileSync(file, 'utf8');
  if (/^draft:\s*true\s*$/m.test(src)) {
    console.error(`refusing to build: content/blog/${slug}.md is a draft,`);
    console.error('so the gist would link to a page that is never published.');
    process.exit(1);
  }
  const title = src.match(/^title:\s*(.+?)\s*$/m)?.[1].replace(/^["']|["']$/g, '');
  if (!title) {
    console.error(`refusing to build: content/blog/${slug}.md has no \`title:\``);
    console.error('and the backlink would have nothing to use as anchor text.');
    process.exit(1);
  }
  return { slug, title, url: `${SITE}/blog/${slug}/` };
}

/* `post:` is one slug or several. Several is the case where more than one post
   sends readers to the same gist — build-gates is the `code:` card on three —
   and the gist should point back at every one of them rather than at whichever
   was written first. */
const backlinks = post => (Array.isArray(post) ? post : [post]).map(backlink);

/* The link a reader is most likely to click is the one they can see without
   scrolling, and the one they are most likely to copy is the one at the end
   with a title attached. The templates carry neither: both are composed here,
   so all ten gists stay consistent and a new one cannot forget. */
function compose(g, links) {
  const [primary, ...also] = links;
  const body = g.readme(primary.url);

  // after the H1 and its blank line, before the first paragraph
  const withHeader = body.replace(
    /^(#[^\n]*\n)\n/,
    `$1\n> **Full write-up:** [${primary.title}](${primary.url})\n\n`,
  );
  if (withHeader === body) {
    console.error(`refusing to build: gist/${g.dir}/0-README.md does not start with an H1,`);
    console.error('so there is nowhere to put the link readers see first.');
    process.exit(1);
  }

  const more = also.length
    ? '\n\nAlso written about in:\n\n' + also.map(l => `- [${l.title}](${l.url})`).join('\n')
    : '';

  return `${withHeader.replace(/\s+$/, '')}\n\n---\n\nWritten up in full here: **[${primary.title}](${primary.url})**${more}\n\n_${g.note}_\n`;
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

/* Snippets from the game engine.
 *
 * Everything else in this file is generated from THIS repo's live config, which
 * is what stops a published snippet drifting from what the site actually runs.
 * The game engine is a different repo, so that guarantee is not available here
 * and pretending otherwise would be worse than saying so.
 *
 * What these are instead: distilled snippets — the interesting 60 lines of a
 * much larger module, with the reasoning kept and the app-specific plumbing
 * removed — written to _source/snippets/ and read from there. They still go
 * through sanitize() and the leak guard below, and they are still one file per
 * subject rather than a paste of a private codebase, which is the shape the
 * posts link to.
 */
const snippet = (dir, file) => sanitize(read(`_source/snippets/${dir}/${file}`));

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

`,
  note: 'Generated from the live configuration — see the post for context.',
}, {
  dir: 'build-gates',
  marker: 'Build gates for a static site — output verification and a Lighthouse budget',
  // Three posts carry this gist as their `code:` card. It links back to all three.
  post: ['build-reviews-ai-code', 'the-check-that-passed-while-broken', 'cloudflare-beacon-csp-blocked'],
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

`,
  note: 'Generated from the live scripts — see the post for context.',
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

`,
  note: 'Generated from the live generator — see the post for context.',
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

`,
  note: 'Generated from the live scripts — see the post for context.',
}, {
  dir: 'puzzle-difficulty-walk',
  marker: 'Rating puzzle difficulty by the decisions a level forces',
  post: 'rating-puzzle-difficulty-by-decisions',
  files: () => ({
    'walk.js':      snippet('puzzle-difficulty-walk', 'walk.js'),
    'summarise.js': snippet('puzzle-difficulty-walk', 'summarise.js'),
    'tiers.js':     snippet('puzzle-difficulty-walk', 'tiers.js'),
  }),
  readme: url => `# Rating a puzzle by the decisions it forces

Grid size is the obvious difficulty proxy and it is wrong. This measures the branching factor
of the solve instead.

\`\`\`
fill the topmost-leftmost empty cell
count how many pieces still in hand could go there
\`\`\`

One means the board placed the piece for you. Five means a real decision, and a wrong answer
that will have to be undone.

## Files

| File | What it is |
| --- | --- |
| \`walk.js\` | The walk, and the four numbers derived from it |
| \`tiers.js\` | Turning a 0-10 rating into a tier a player can read |

## Worth knowing

- **The walk has to be exact, because it runs three times.** Offline in the rater, again in an
  independent verifier, and again on the device — two power-ups are this walk with a different
  question asked of it, and the economy is priced off its \`decisions\` total. A test asserts all
  three agree, board for board, or the build fails. Approximation makes that impossible to check.
- **Tier boundaries are the pack's own quartiles**, not round numbers. p25/p50/p75/p90 split one
  392-board library 23/25/24/15/12 percent. Round numbers put 60% of it in one tier.
- **Ratings must overlap across board sizes.** If they form disjoint bands by size, the model is
  measuring size. A 10x10 here spans 4.0 to 7.7 and meets both the 8x8s below and the 13x13s above.
- **Leave out dimensions you do not have.** No timer, no dexterity, no luck — so no precision,
  reaction or randomness axes. A dimension that is always 0 dilutes every weight next to it.
- **The rating is a prior.** \`confidence: 0.2\`, \`sampleCount: 0\`. It measures the board, not the
  difficulty a person experiences, and the code says so rather than pretending.

`,
  note: 'A distilled snippet from a shipped engine — see the post for context.',
}, {
  dir: 'campaign-progression',
  marker: 'Campaign ordering — difficulty rates a level, progression places it',
  post: 'difficulty-rates-progression-places',
  files: () => ({
    'envelope.js': snippet('campaign-progression', 'envelope.js'),
    'beats.js':    snippet('campaign-progression', 'beats.js'),
    'tones.js':    snippet('campaign-progression', 'tones.js'),
  }),
  readme: url => `# Ordering a campaign without sorting it

Sorting a level library easiest-to-hardest produces a campaign that is flat for a hundred levels
and then a wall. On one 392-board library it put all 92 Easy boards inside the first 138 stages,
with no Tricky board until stage 133.

The rule that replaced it:

> Difficulty **rates** a level. Progression **places** it.

The library is a pool. Each slot carries an ask — a target, a tone, constraints — and the best
remaining level is chosen for it on difficulty, role, ramp and variety together.

## The three that took a rewrite each

- **The target is a quantile of what is left, not the minimum.** Anchoring to the easiest unplayed
  level sounds equivalent. It is not: the pool is consumed roughly easiest-first, so the minimum
  creeps up one level at a time and the target creeps with it — a sort wearing a rhythm.
- **Tone windows are four different ranges, not one band.** A single symmetric band makes an easy
  level *ineligible* once the anchor climbs past it, so the whole easy tail is untouchable through
  the middle and has nowhere to go but the end.
- **Beat order matters as much as beat counts.** With a comfort beat before the milestone, the
  milestone has to climb out of a dip and the anti-oscillation cap holds it down: only four of
  eighteen were the hardest board anywhere near them.

## Worth knowing

- **\`MODEL_VERSION\` is a migration.** Level numbers are saved progress. Bumping it keeps a
  player's completed count and changes which levels those numbers mean.
- **Damping the rhythm for beginners is the wrong protection** — it flattens the opening into one
  long shallow run. Beginners need no *spikes*, which is one line, not a curve change.
- **Record how every slot was filled.** When no candidate fits, the builder loosens one constraint
  at a time and writes down which. That turns "why is level 214 a 3.1?" into reading one object.

`,
  note: 'A distilled snippet from a shipped engine — see the post for context.',
}, {
  dir: 'vite-shrink-pack',
  marker: 'A Vite plugin that shrinks a JSON content pack into the build output',
  post: 'shipping-a-4mb-level-pack',
  files: () => ({
    'shrink-stage-pack.js': snippet('vite-shrink-pack', 'shrink-stage-pack.js'),
  }),
  readme: url => `# Two Vite plugins for a Capacitor game

One shrinks a JSON content pack on its way into \`dist/\`; the other removes an SDK the shipped
app can never execute.

## Files

One file. It minifies a JSON content pack on its way into \`dist/\`, leaving the repo copies
pretty-printed and diffable: 4.37 MB -> 2.36 MB, 45% of it whitespace nothing reads at runtime.

## The two bugs these encode

**\`closeBundle\` also fires when the build failed.** A cleanup hook there throws its own ENOENT
about a \`dist/\` that was never created, and replaces the real error with it. \`writeBundle\` runs
only on a successful write — and Vite copies \`publicDir\` into \`outDir\` *before* the write phase,
so the files are already there. (Get \`outDir\` from \`configResolved\`, too: Vite may load a config
from a temp file, so \`import.meta.dirname\` can point into \`node_modules/.vite-temp/\`.)

**Capacitor plugins ship a browser fallback you cannot tree-shake.** Every
\`@capacitor-firebase/*\` plugin registers \`web: () => import('./web')\`. \`registerPlugin\` only calls
it on a browser, but it is a static import site, so the bundler emits it — and each of those
\`web.js\` files drags in its slice of the Firebase JS SDK. That, not app code, is where a 525 KB
Firestore chunk and a 168 KB Auth chunk come from.

## The part to copy even if you copy nothing else

\`generateBundle\` scans the emitted chunks and **fails the build** if the SDK reappears. A stub
only helps while nothing re-imports the real thing; without the assertion the next dependency
upgrade quietly puts 700 KB back and nobody finds out.

`,
  note: 'A distilled snippet from a shipped engine — see the post for context.',
}, {
  dir: 'capacitor-android-size',
  marker: 'Cutting a Capacitor Android download in half — R8, ProGuard and the real delivered size',
  post: 'capacitor-android-build-apk-size',
  files: () => ({
    'release-build.gradle': snippet('capacitor-android-size', 'release-build.gradle'),
    'proguard-rules.pro':   snippet('capacitor-android-size', 'proguard-rules.pro'),
    'delivered-size.mjs':   snippet('capacitor-android-size', 'delivered-size.mjs'),
    'drop-web-firebase.js': snippet('capacitor-android-size', 'drop-web-firebase.js'),
  }),
  readme: url => `# Cutting a Capacitor Android download in half

13.09 MB -> 5.88 MB delivered, on a WebView game with 392 levels of JSON in it.

\`\`\`
dex             9.55 MB  ->  4.24 MB     R8 on
web assets      1.65 MB  ->  1.10 MB     the SDK the app cannot run
splash + icons  1.15 MB  ->  0.13 MB     PNG -> WebP
SDK metadata    0.16 MB  ->  0.02 MB     packaging excludes
\`\`\`

## Files

| File | What it is |
| --- | --- |
| \`release-build.gradle\` | The release block \`npx cap add android\` does not give you |
| \`proguard-rules.pro\` | Keep rules R8 cannot infer, for a Capacitor app |
| \`delivered-size.mjs\` | What a phone actually downloads from an \`.aab\` |
| \`drop-web-firebase.js\` | Vite plugin: stub the SDK a native build can never execute |

## Read the right number first

\`ls -l\` on the \`.aab\` is not the download. Play splits a bundle per density, ABI and language,
and strips its own metadata. Turning on R8 *adds* a multi-megabyte \`proguard.map\` under
\`BUNDLE-METADATA/\` that is never delivered — so the file on disk can look barely improved while
the real download has halved.

## Things that will bite you

- **R8 is off in the generated project.** \`minifyEnabled false\` is the Capacitor default, so every
  class of Play Services, Firebase and gRPC ships whole. Four lines of Gradle is the single
  largest win available.
- **A dependency can disable your optimisation and nothing tells you.** One auth library shipped
  \`-keep class com.google.android.gms.internal.** { *; }\` as a *consumer* rule — 9,304 classes
  pinned unshrunk, and an app-optimisation score of 28% with R8 already on. If the numbers are
  worse than they should be, unzip the AARs and grep for \`-keep\`.
- **The first R8 build fails on a provider SDK you do not use.** Auth plugins compile in handlers
  for every provider they support. R8 writes the exact rules you need to
  \`app/build/outputs/mapping/release/missing_rules.txt\` — copy from there.
- **\`@JavascriptInterface\` on an anonymous object is a silent, release-only breakage.** The bridge
  method returns \`undefined\` and nothing throws.
- **PNG splash screens are enormous.** A full-bleed gradient is close to the worst case for PNG's
  row filters: 457 KB as PNG, 28 KB as WebP at q88, indistinguishable. \`@drawable/splash\` resolves
  to either extension, so there is no XML to change.
- **Verify on a device, in the release variant.** R8 breaks things by removing code reached only
  reflectively, and that is the one build nobody runs during development.

`,
  note: 'A distilled snippet from a shipped engine — see the post for context.',
}, {
  dir: 'pack-conformance',
  marker: 'Conformance suite for generated game content — walk every level before shipping it',
  post: 'testing-a-level-pack-you-did-not-write',
  files: () => ({
    'pack-suite.js': snippet('pack-conformance', 'pack-suite.js'),
  }),
  readme: url => `# Testing content you did not write

The failure mode of a bad content pack is not a crash. It is a level that cannot be solved,
found by a player, three weeks after release, in a review. Unit tests will not find it — they
test the code, and the code is faithfully rendering an impossible board.

Each game's whole test file:

\`\`\`js
import { describeGameShell } from '@your-scope/engine/testing'

describeGameShell(import.meta.url)
\`\`\`

The suites live in the **engine**, not the game. A copy per app is a copy that drifts, and the
sibling whose copy is stale is the one that ships the broken pack.

## What it checks

| Suite | Catches |
| --- | --- |
| board walk | a level that dead-ends, and shipped metrics that no longer match |
| opening layout | overlapping pieces, and an arrangement that leaks the answer |
| pack declaration | a stage count that disagrees with the catalogue on disk |
| shell | game logic appearing in an app directory |

## The assertion worth stealing

Re-derive the generator's own claims from the shipped artifact. Three numbers ride on every
level here, written months earlier by a different implementation in another repo; the runtime
recomputes them and they must match exactly.

That one check ties together the difficulty model, the campaign order built from it, the
power-ups that use it and the prices derived from it. If any drifts, the game keeps working and
starts **lying** — and nothing throws.

Every genuine content bug is of the form "the data says X and the data is wrong". A test that
mocks the data cannot see any of them.

## Do not sample it

Walking every level is seconds, not milliseconds. Sample it and you have a check that passes on
the run where it mattered: the interesting board is always the one you did not draw. If it gets
too slow, move it to the pack build and the release build — not to fewer levels.

`,
  note: 'A distilled snippet from a shipped engine — see the post for context.',
}, {
  dir: 'game-economy',
  marker: 'A mobile game coin economy priced off its own difficulty model',
  post: 'pricing-an-economy-off-its-difficulty-model',
  files: () => ({
    'economy.js': snippet('game-economy', 'economy.js'),
  }),
  readme: url => `# An economy priced off the difficulty model

Levels in this game differ **13x** in the thinking they demand — a decision load of 7.5 on the
easiest tier against 96.7 on the hardest. A flat coin reward is therefore wrong on nearly all of
them, and it teaches players to grind the easy end and never touch the interesting levels.

\`\`\`js
clearReward = round(6 + 0.30 * decisionLoad)   // 8 coins Easy, 35 Expert
\`\`\`

## The structural decision

Nothing in this module touches the UI framework, the store, or storage. That is what lets the
**balance simulator import the same file**. A simulator that re-implements the economy describes
a game you are not shipping, and it diverges on the first tuning pass without telling you.

## What simulation found that play did not

- **Star bonuses were 45% of all income** — the largest faucet in the game, while three stars is
  earned on two thirds of levels. That is a salary, not a reward. They are now paid as a *delta*
  against the best tier ever banked, so replaying a completed level nets zero.
- **The daily chest escalated without limit.** By the eighth cycle its day-7 chest paid 225 coins
  — more than three level clears — for opening the app.
- **The largest single payout sets the price floor.** If a hint costs less than the top star
  delta, buying hints until three stars is guaranteed is optimal, forever, and the economy is a
  vending machine.

## Ads

Rewarded video is a **multiplier on the level**, never a flat coin amount, so it inherits the
difficulty scaling for free. Doubling a 35-coin clear is worth watching; doubling an 8-coin one
is not, and the player self-selects. A flat "watch for 25 coins" inverts that.

## Assert properties, not numbers

The simulator's \`--test\` mode checks that no legitimate action sequence produces unbounded
coins, that every item is reachable from zero, that replaying never nets positive, and that the
difficulty walk the prices derive from still matches the metrics shipped on every level.

`,
  note: 'A distilled snippet from a shipped engine — see the post for context.',
}];

/* ─────────────────────────── build ─────────────────────────── */

/* guard: never publish anything identifying */
const LEAKS = ['indiecore.net', 'oettaib', 'indiecode25', 'Othmane', 'Ettaib', '943 647', 'Bretagne'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const manifest = [];

for (const g of GISTS) {
  const links = backlinks(g.post);
  const files = { '0-README.md': compose(g, links), ...g.files() };
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
  // `post` stays the primary slug so existing readers of this file keep working;
  // `posts` is every post the gist links back to.
  manifest.push({ dir: g.dir, marker: g.marker, post: links[0].slug, posts: links.map(l => l.slug) });

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
