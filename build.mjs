import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { GIST_DIR, GIST_RE, gistAnchor, resolveGistEmbed } from './scripts/gist-embed.mjs';
import { violations as calendarViolations } from './scripts/schedule-rule.mjs';
import hljs from 'highlight.js';

/* Syntax highlighting happens at build time — no runtime JS, no CDN. */
const marked = new Marked(markedHighlight({
  emptyLangClass: 'hljs',
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
}));

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT  = path.join(ROOT, 'dist');
const SITE = 'https://www.indiecore.net';
const EMAIL = 'contact@indiecore.net';

/* Mailing list. The form posts straight to Kit — no embed script, no iframe,
   no third-party JS on any page here. That is why /subscribe/ works with
   JavaScript off, and why the only CSP concession is form-action.
   KIT.processor and KIT.dpf feed the privacy policy; scripts/verify.mjs fails
   the build while either still says TODO, because a legal section naming a
   processor cannot ship half-written. */
const KIT = {
  origin:    'https://app.kit.com',        // where the form POSTs
  /* form-action is checked against every hop of a redirect chain, not just the
     POST target — it is one of the few directives that follows redirects. Kit
     answers the POST with a 302 to the apex domain, which 301s to www, so all
     three hosts have to be listed. Allowing only app.kit.com blocks the
     submission and Chrome reports the violation against the *original* action
     URL, which reads as a contradiction: the URL it names is the one allowed. */
  returnTo:  ['https://indiecore.net', 'https://www.indiecore.net'],
  action:    'https://app.kit.com/forms/9865536/subscriptions',
  // Kit rebranded from ConvertKit and the paperwork has not caught up: the
  // Terms name Kit Inc., while the Data Privacy Framework register still lists
  // the certification under ConvertKit LLC. Naming only one leaves a reader
  // unable to verify the other, so the policy names both.
  processor: 'Kit Inc.',
  dpf:       'Certified to the EU&ndash;US Data Privacy Framework under its former name, ConvertKit LLC.',
  badge:     'https://kit.com/features/forms?utm_campaign=poweredby&utm_content=form&utm_medium=referral&utm_source=dynamic',
};

/* Identity published in the footer, the Organization schema, /about/, /contact/
   and /legal/. One source so the five cannot disagree — LCEN requires the
   legal notice to be accurate, and a stale copy in a footer is still a copy. */
const LEGAL = {
  name:      'Othmane Ettaib',
  trading:   'Indie Core Dev',
  form:      'Entreprise individuelle (sole proprietorship)',
  street:    '4 rue de Bretagne',
  postalCode:'94000',
  city:      'Créteil',
  country:   'France',
  siren:     '943 647 503',
  ape:       '6201Z — Computer programming',
  founded:   'April 2025',
  updated:   '28 August 2026',
};
LEGAL.address = `${LEGAL.street}, ${LEGAL.postalCode} ${LEGAL.city}, ${LEGAL.country}`;
/* IndexNow ownership key. Public by design — it only authorises submissions
   while it is readable at https://www.indiecore.net/<key>.txt, which is why
   the same file feeds both the build and scripts/seo-ping.mjs. */
const INDEXNOW_KEY = fs.readFileSync(path.join(ROOT, '_source/indexnow-key.txt'), 'utf8').trim();
const play = JSON.parse(fs.readFileSync(path.join(ROOT, '_source/play-data.json'), 'utf8'));
const pkg  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* Version: major.minor come from package.json (bumped by hand for real
   releases); the patch is the git commit count, so it increments on its own
   with every commit. No commit-back to the repo, and always monotonic. */
function buildVersion() {
  const git = a => { try { return execFileSync('git', a, {cwd: ROOT}).toString().trim(); } catch { return ''; } };
  const [major = '1', minor = '0'] = String(pkg.version).split('.');
  const count = git(['rev-list', '--count', 'HEAD']);
  const sha   = git(['rev-parse', '--short=7', 'HEAD']);
  const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
  if (!count || shallow) {
    // CI must checkout with fetch-depth: 0 for an accurate count.
    if (shallow) console.warn('! shallow clone — commit count unreliable, falling back to package.json version');
    return { version: pkg.version, sha: sha || 'unknown', date: new Date().toISOString().slice(0, 10) };
  }
  return { version: `${major}.${minor}.${count}`, sha, date: new Date().toISOString().slice(0, 10) };
}
const BUILD = buildVersion();

/* ───────── helpers ───────── */
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ents = s => String(s)
  .replace(/&#(\d+);/g, (_,n) => String.fromCharCode(+n))
  .replace(/&nbsp;/g,' ').replace(/&copy;/g,'©').replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const write = (rel, html) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), {recursive:true});
  fs.writeFileSync(f, rel.endsWith('.html')
    ? versionAssets(enhanceImages(unrevealHero(html))) : html);
};
const gridCols = n => Math.min(n, 6);
/* The screenshot grid is `cols` columns of at most `max`, inside .shell
   (min(100vw,1240) - 48 of content) with 20px gaps, and each .shot adds 6px of
   padding either side. Under 560px it stops being a grid and scrolls sideways
   at a fixed 196px. Every number below comes from that layout rather than from
   a guess: a hand-written sizes string was declaring 280px for a slot that
   measures 116px on a tablet, so the browser was fetching the full 506px file
   for it. The grid width depends on the shot count, which is why this is
   generated per game instead of written once. */
function shotsSizes(cols, max) {
  const gap   = 20 * (cols - 1);
  const fluid = `calc((100vw - ${48 + gap}px) / ${cols} - 12px)`;
  const capVw = max * cols + gap + 48;   // viewport where --max starts winning
  return capVw < 1288
    ? `(max-width:560px) 184px, (max-width:${capVw}px) ${fluid}, ${max - 12}px`
    : `(max-width:560px) 184px, (max-width:1288px) ${fluid}, ${Math.round((1192 - gap) / cols) - 12}px`;
}
const gridMax  = n => n <= 3 ? 336 : 264;
const shotsFor = key => fs.readdirSync(path.join(ROOT,'public/assets/games'))
  .filter(f => f.startsWith(key + '-') && /-\d+\.jpg$/.test(f)).sort();


/* intrinsic size of a baseline/progressive JPEG (SOFn marker) */
function jpegSize(buf){
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i+1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
      return { h: buf.readUInt16BE(i+5), w: buf.readUInt16BE(i+7) };
    i += 2 + buf.readUInt16BE(i+2);
  }
  return null;
}
/* Whether <picture> may advertise a WebP source at all. A <source> that 404s
   is not recoverable — the browser does not fall back to the next source or to
   the <img>, it just shows a broken image — so this is settled once, up front,
   rather than assumed. */
const HAS_WEBP = (() => {
  try { execFileSync('cwebp', ['-version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
})();
if (!HAS_WEBP) console.warn('cwebp not found — building JPEG-only <picture> markup');

const DIMS = {};
for (const f of fs.readdirSync(path.join(ROOT,'public/assets/games'))) {
  if (!f.endsWith('.jpg')) continue;
  const d = jpegSize(fs.readFileSync(path.join(ROOT,'public/assets/games',f)));
  if (d) DIMS[f] = d;
}

/* the first section is already on screen at load — revealing it only delays LCP */
function unrevealHero(html){
  const m = html.match(/<main id="main">\s*<section[^>]*>[\s\S]*?<\/section>/);
  if (!m) return html;
  const cleaned = m[0].replace(/class="([^"]*)"/g, (mm, c) => {
    const kept = c.split(/\s+/).filter(x => x && x !== 'rv').join(' ');
    return kept ? `class="${kept}"` : '';
  }).replace(/\sstyle="transition-delay:[^"]*"/g, '');
  return html.replace(m[0], cleaned);
}

/* ── asset versioning ──────────────────────────────────────────────────
   /assets/games/* and /assets/fonts/* are served immutable for a year under
   names that do not change when the file behind them does. A screenshot keeps
   its name when it is replaced, deliberately: Google Images has the name
   indexed, and the redirect block further down exists because renaming artwork
   once already cost exactly that. So the cache key rides in a query instead —
   soda-jam-02.jpg?v=<hash of the bytes>.

   That query is the whole reason `immutable` is safe here. A browser only ever
   learns these URLs from the HTML, which is served must-revalidate, so a
   replaced file arrives under a URL the browser has never seen and is fetched
   on the next visit. Without it there is nothing that reaches a client holding
   the old bytes: it is not asking us anything, and no deploy can make it.

   WebP derivatives key off their source JPEG. They are a pure function of
   those bytes plus the encoder settings, and they do not exist yet at the
   point the HTML is written. */
const ASSET_SRC = { games: 'public/assets/games', fonts: 'public/assets/fonts' };
const assetVer  = new Map();

/* soda-jam-02.webp and soda-jam-02-320.webp are both encoded from
   soda-jam-02.jpg, so all three carry that one file's hash. */
function assetOrigin(kind, file) {
  const dir  = path.join(ROOT, ASSET_SRC[kind]);
  const bare = file.replace(/\.webp$/, '');
  for (const c of [file, `${bare}.jpg`, `${bare.replace(/-\d+$/, '')}.jpg`]) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function assetVersion(kind, file) {
  const key = `${kind}/${file}`;
  if (!assetVer.has(key)) {
    const src = assetOrigin(kind, file);
    assetVer.set(key, src
      ? crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex').slice(0, 8)
      : null);
  }
  return assetVer.get(key);
}

/* Runs last, after enhanceImages: that one matches a src ending in .jpg, and a
   query arriving on the way in would stop it matching at all.

   The lookbehind is what keeps this off the absolute URLs in JSON-LD and
   og:image — in `…indiecore.net/assets/…` the slash has a letter before it.
   Those are read by Google and by social scrapers, where one URL that never
   moves is worth more than a cache key. */
const versionAssets = html => html.replace(
  /(?<=["'(\s,])\/assets\/(games|fonts)\/([A-Za-z0-9._-]+\.(?:jpg|webp|woff2))/g,
  (m, kind, file) => {
    const v = assetVersion(kind, file);
    return v ? `/assets/${kind}/${file}?v=${v}` : m;
  });

/* gist:responsive-markup */
/* add intrinsic width/height (stops layout shift) and serve WebP with a JPEG fallback */
function enhanceImages(html){
  return html.replace(/<img ([^>]*?)src="\/assets\/games\/([^"]+\.jpg)"([^>]*?)>/g, (m, pre, file, post) => {
    const d = DIMS[file];
    const hasWH = /\bwidth=/.test(pre + post);
    const wh = (d && !hasWH) ? ` width="${d.w}" height="${d.h}"` : '';
    const attrs = pre + post + wh;

    // A lazy image is by definition not the LCP element, so let its decode go
    // off the main thread. The hero deliberately keeps the synchronous default.
    const dec = (/loading="lazy"/.test(attrs) && !/\bdecoding=/.test(attrs))
      ? ' decoding="async"' : '';
    const img = `<img ${pre}src="/assets/games/${file}"${post}${wh}${dec}>`;

    if (!HAS_WEBP) return img;

    const base = file.replace(/\.jpg$/,'');
    const p = `/assets/games/${base}`;
    const isFeature = /-feature$/.test(base);
    const isIcon    = /-icon$/.test(base);
    // data-hero is the three floating phones on the home page and nothing else.
    // It used to mark the game-page carousel too, which is a different width
    // (a constant 254px against the phones' 154-242px), so one of the two was
    // always sized for the other's layout.
    const isHero    = /\bdata-hero\b/.test(attrs);
    const isShot    = /-\d+$/.test(base);

    // The slot an icon fills depends on the template — 56px on the home rows,
    // 88px on a game header, 60px on the related-games cards — and the <img>
    // already carries the real number. Reading it beats a hand-written sizes
    // string that is necessarily wrong for two of the three.
    const iconPx = +(/\bwidth="(\d+)"/.exec(attrs)?.[1] || 56);

    // The screenshot grid on a game page carries its own layout, because it is
    // the same file as the carousel but rendered at a completely different
    // width — 116px in a five-across grid on a tablet against the carousel's
    // constant 254px. One shared sizes string could only ever be right for one
    // of them, and it was right for neither.
    const grid = /\bdata-shot="(\d+):(\d+)"/.exec(attrs);

    // The hero stays at 200/320 on purpose: it is the LCP element on the home
    // page, and offering it a 400w candidate makes the one image on the
    // critical path bigger to fix a sharpness nobody reported.
    //
    // The carousel stops at 400w for a related reason. Its slot is 254px at
    // every breakpoint, so 400w is already ~1.6x — past the point anyone can
    // see on a screenshot — while the 506w original costs 40% more bytes for
    // an image that sits below the fold.
    // The grid and the carousel share one ladder on purpose. A game page renders
    // the same five screenshots twice, so ladders that disagree make the browser
    // fetch every shot twice — capping only one of them measured 397 -> 578 KiB.
    const set = isFeature ? [[`${p}-400`, 400], [`${p}-640`, 640],
                             [`${p}-880`, 880], [p, 1024]]
              : isIcon    ? [[`${p}-112`, 112], [`${p}-176`, 176]]
              : (isHero || grid || isShot)
                          ? [[`${p}-200`, 200], [`${p}-320`, 320]]
              : null;

    // .keyart fills .shell, which is min(100vw,1240) minus 48px of padding.
    // The old string claimed 100vw and so fetched the 1024w file for a slot
    // measuring 362px on a phone.
    const sizes = isFeature ? '(max-width:1288px) calc(100vw - 48px), 1192px'
                : isIcon    ? `${iconPx}px`
                : isHero    ? '(max-width:560px) 180px, 242px'
                : grid      ? shotsSizes(+grid[1], +grid[2])
                : isShot    ? '254px'
                : '';

    // The lightbox opens the full-size image, and app.js used to read it from
    // the <img> src — which is the JPEG fallback, so every enlarge pulled 217 KB
    // when a 70 KB WebP of the same picture was already sitting in dist/.
    const full = grid ? ` data-full="${p}.webp"` : '';

    const srcset = set ? set.map(([u, w]) => `${u}.webp ${w}w`).join(', ') : `${p}.webp`;
    const source = `<source type="image/webp" srcset="${srcset}"`
      + (sizes ? ` sizes="${sizes}"` : '') + '>';
    return `<picture>${source}${img.replace('<img ', '<img' + full + ' ')}</picture>`;
  });
}
/* /gist:responsive-markup */

/* ───────── game data ───────── */
const GAMES = [
  { key:'word-slot',    slug:'word-slot',                 legacy:'privacy-policy-for-word-slot',
    blurb:'A crossword cut into blocks and scattered across the board. Slot every piece back until each row and column reads as a real word \u2014 and nothing on screen tells you when you are right. Working that out is the game.',
    feats:['392 hand-built stages','No timer, no fail state','Cloud save','Plays offline'] },
  { key:'soda-jam',     slug:'soda-jam-color-sort',       legacy:'privacy-policy-for-soda-jam-color-sort',
    blurb:'Pour, sort and clear the bottles until every colour finds its place. It starts gentle and turns genuinely mean — in the best way.',
    feats:['Hundreds of levels','No timer pressure','Undo & hints','Plays offline'] },
  { key:'gridsmash',    slug:'color-block-puzzle-master', legacy:'privacy-policy-for-gridsmash-block',
    asset:'color-block-puzzle-master',
    video:'eOv0iC1BGfg',   // official gameplay trailer, the one listing that has one
    blurb:'Drop blocks, clear lines, chain the combo. One more go turns into an hour, and the grid never blinks first.',
    feats:['Combo scoring','Play Games leaderboards','Achievements','Plays offline'] },
  { key:'logo-quiz',    slug:'logo-quiz-guess-brand',     legacy:'privacy-policy-for-logo-quiz-guess-brand',
    blurb:'Reveal the logo, name the brand. You know more than you think you do — until suddenly you don’t.',
    feats:['Cloud save','Level packs','Hint system','Plays offline'] },
  { key:'perfectmatch', slug:'number-match-merge-puzzle', legacy:'privacy-policy-for-perfectmatch-numbers',
    asset:'number-match-merge-puzzle',
    blurb:'Match the pairs, merge the numbers, clear the board before it fills. The first game we shipped, and still the purest loop we’ve made.',
    feats:['Classic & endless','Quick sessions','No timer','Plays offline'] },

  /* Not on Play yet, so there is no listing to read metadata from and no
     artwork to build a gallery out of. Everything it needs is here; the !live
     branches render a placeholder and a "Coming soon" pill instead. Delete
     these fields and add the assets when it ships. */
  { key:'mot-malin',    slug:'mot-malin',                 legacy:'privacy-policy-for-mot-malin',
    live:false, name:'Mot Malin', pkg:'com.motmalin.fillincrossword', category:'Word',
    tagline:'Word Slot in French — the same fill-in crossword, built around French words.',
    blurb:'The French edition of Word Slot. A crossword cut into blocks and scattered across the board; slot every piece back until each row and column reads as a real French word.',
    feats:['French word list','No timer, no fail state','Cloud save','Plays offline'] },
].map(g => {
  const p = play[g.key] || {};                       // no Play listing yet -> entry carries its own
  const art = f => fs.existsSync(path.join(ROOT, 'public/assets/games', f)) ? f : '';
  // `key` identifies the game to us and to the Play scrape. `asset` names its
  // image files, and defaults to the same thing — they only differ where the
  // key is an internal codename, because Google reads the file name to work out
  // what an image is, and "gridsmash" is a word no player has ever searched for.
  // Renaming the key instead would mean renaming what the scraper writes.
  const a = g.asset || g.key;
  return { live:true, ...p, ...g,
           name: g.name || p.title, tagline: g.tagline || p.short,
           pkg: g.pkg || p.pkg,
           playUrl:`https://play.google.com/store/apps/details?id=${g.pkg || p.pkg}`,
           shots:shotsFor(a),
           icon:art(`${a}-icon.jpg`), feature:art(`${a}-feature.jpg`) };
});

const ALL = GAMES;


/* ───────── privacy policy parsing ───────── */
function parsePolicy(legacySlug){
  let t = fs.readFileSync(path.join(ROOT, `_source/legacy/txt_${legacySlug}.txt`), 'utf8');
  t = ents(t);
  t = t.replace(/^[\s\S]*?post-body[^>]*>/, '');                 // drop blogger wrapper
  t = t.split(/\n-\s*\n\nObtenir le lien/)[0];                   // drop share widget onward
  t = t.split(/window\['__wavt'\]/)[0];
  t = t.replace(/\[email\s*protected\]/gi, EMAIL);
  t = t.replace(/\n?Commentaires[\s\S]*$/,'').replace(/\n?©[\s\S]*$/,'');

  const meta = {};
  for (const [k,re] of Object.entries({
    effective:/Effective Date:\s*(.+)/, updated:/Last Updated:\s*(.+)/,
    pkg:/Package ID:\s*(.+)/, email:/Contact Email:\s*(.+)/,
  })) { const m = t.match(re); if (m) meta[k] = m[1].trim(); }

  const parts = t.split(/^(\d{1,2})\.\s+(.+)$/m);
  const sections = [];
  for (let i = 1; i < parts.length; i += 3) {
    const num = parts[i], head = parts[i+1].trim();
    const blocks = parts[i+2].split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    sections.push({ num, head, blocks });
  }
  return { meta, sections };
}
function renderBlocks(blocks){
  let html = '', list = [];
  const flush = () => { if (list.length){ html += `<ul>${list.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`; list = []; } };
  for (const b of blocks) {
    if (b.startsWith('- ')) { list.push(b.slice(2).trim()); continue; }
    flush();
    html += `<p>${esc(b)}</p>`;
  }
  flush();
  return html;
}

function renderDesc(raw){
  return ents(String(raw)).split(/<br>\s*<br>/).map(block => {
    const lines = block.split(/<br>/).map(l => l.trim()).filter(Boolean);
    const out = []; let list = [];
    const flush = () => { if (list.length) { out.push(`<ul>${list.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`); list = []; } };
    for (const l of lines) {
      if (/^[•\-\u2013]\s+/.test(l)) { list.push(l.replace(/^[•\-\u2013]\s+/,'')); continue; }
      if ((l.match(/•/g) || []).length >= 2) {
        const parts = l.split('•').map(x => x.trim()).filter(Boolean);
        const head = parts.shift();
        flush();
        if (head) out.push(`<p class="lead-in"><strong>${esc(head)}</strong></p>`);
        list.push(...parts);
        continue;
      }
      flush(); out.push(`<p>${esc(l)}</p>`);
    }
    flush();
    return out.join('');
  }).join('');
}

const FONT_FILES = fs.readdirSync(path.join(ROOT,'public/assets/fonts')).filter(f=>f.endsWith('.woff2'));
/* Every weight the nav and the buttons need, preloaded. Referenced only from
   the inlined @font-face rules, 600 and 700 were not discoverable until the
   browser had parsed the CSS and laid the page out, which is the one thing
   the network-dependency insight fails on. */
const FONT_PRELOAD = FONT_FILES
  .filter(f => /bricolage.*-800-|jakarta.*-(400|600|700)-/.test(f))
  .map(f => `<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/${f}" crossorigin>`)
  .join('\n');

/* Metric-matched fallback for Plus Jakarta Sans.
   Jakarta is font-display:swap, so text paints in the fallback first and then
   swaps. Helvetica and Arial are narrower and shorter than Jakarta, so that
   swap resized every nav link and shifted the row — the one thing cls-culprits
   reported, at 0.000221 on desktop.

   size-adjust makes the fallback occupy Jakarta's width; the ascent and descent
   overrides rebuild the line box after that rescale, so the swap changes glyph
   shapes and nothing else. The numbers are measured, not guessed: rendered in
   Chrome at 100px through canvas measureText, per weight, against both
   Helvetica Neue and Arial (which differ by at most 1.2%, so each value is
   their average).

   Each weight is calibrated on the text it actually renders — 600 on the nav,
   which is the row that shifts, 700 on button labels, 400 on prose. The width
   ratio between two typefaces is not one number: it depends on the glyph mix,
   and calibrating 600 on a pangram instead of the nav left it 0.67% short and
   the shift almost untouched.

   All three are measured against the *regular* fallback face, which is the
   subtle part. local() inside @font-face resolves to one face, and the
   font-weight descriptor only labels it — it does not pick a bold. So the
   fallback for 600 and 700 is regular Helvetica relabelled, and sizing it
   against Helvetica Bold made those two weights 6% too narrow, worse than
   having no fallback at all. It renders lighter than Jakarta for the moment
   before the swap; matching the metrics is the point, not matching the
   colour. Re-derive by measuring again if the typeface changes. */
const FONT_FALLBACK = [
  [400, 104.04, 99.96, 21.15],
  [600, 108.00, 96.29, 20.37],
  [700, 105.73, 98.36, 20.81],
].map(([w, size, asc, desc]) =>
  `@font-face{font-family:'Jakarta Fallback';font-style:normal;font-weight:${w};`
  + `src:local('Helvetica Neue'),local('Helvetica'),local('Arial');`
  + `size-adjust:${size}%;ascent-override:${asc}%;descent-override:${desc}%;line-gap-override:0%}`
).join('');

const FONT_CSS = fs.readFileSync(path.join(ROOT,'public/assets/fonts/fonts.css'),'utf8')
  .replace(/(@font-face\s*\{[^}]*?Plus Jakarta Sans[^}]*?)font-display:\s*optional/g, '$1font-display:swap')
  .replace(/\s+/g,' ').trim() + FONT_FALLBACK;
/* app.js is fingerprinted so it can be cached for a year instead of a day.
   The name is derived here because the <script> tag, the file written into
   dist/ and the _headers rule all have to agree, and they are three different
   places in this file. scripts/verify.mjs resolves it by glob for the same
   reason — it reads app.js to check the storage keys against the policy. */
const APP_SRC  = fs.readFileSync(path.join(ROOT,'src/app.js'),'utf8');
const APP_FILE = `app.${crypto.createHash('sha256').update(APP_SRC).digest('hex').slice(0,8)}.js`;

/* ── per-page CSS ──────────────────────────────────────────────────────
   Inlining the stylesheet is what keeps the critical path at zero
   render-blocking requests, but it also meant every page carried all
   32 KB of it — the blog's syntax theme on the privacy policy, the
   lightbox on the contact page.

   Each page now gets only the rules it can match, decided by class name.
   A selector naming no class (body, h1, :root, *) is always kept, and a
   selector list is filtered member by member rather than all-or-nothing.

   The one thing class names in the HTML cannot reveal is markup that
   does not exist yet: app.js builds the lightbox and the trailer at
   runtime. Those names are read back out of the script instead of being
   listed here, so adding a runtime class keeps working without anyone
   having to remember this comment. verify.mjs re-checks the result
   against each page independently. */
const RAW_CSS = fs.readFileSync(path.join(ROOT,'src/styles.css'),'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'');

const squash = css => css
  .replace(/\s*([{}:;,>])\s*/g,'$1').replace(/;}/g,'}').replace(/\s+/g,' ').trim();

/* class names app.js attaches at runtime, so they never appear in the HTML */
const JS_CLASSES = new Set([
  ...[...APP_SRC.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)].map(m => m[1]),
  ...[...APP_SRC.matchAll(/className\s*=\s*'([^']+)'/g)].flatMap(m => m[1].split(/\s+/)),
  ...[...APP_SRC.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)),
].filter(Boolean));

/* top-level rules, with @media bodies left intact for a recursive pass */
function cssRules(css){
  const rules = []; let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    const from = i;
    while (i < css.length && css[i] !== '{') i++;
    if (i >= css.length) break;
    const prelude = css.slice(from, i).trim();
    let depth = 0, j = i;
    do { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    while (j < css.length && depth > 0);
    rules.push({ prelude, body: css.slice(i + 1, j - 1) });
    i = j;
  }
  return rules;
}

const classesOf = sel => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]);

function selectCss(css, used){
  const out = [];
  for (const { prelude, body } of cssRules(css)) {
    if (/^@(media|supports)/i.test(prelude)) {
      const inner = selectCss(body, used);
      if (inner) out.push(`${prelude}{${inner}}`);
      continue;
    }
    if (/^@keyframes/i.test(prelude)) continue;   // resolved by reference below
    const kept = prelude.split(',').map(s => s.trim()).filter(s => {
      const cs = classesOf(s);
      return !cs.length || cs.some(c => used.has(c));
    });
    if (kept.length) out.push(`${kept.join(',')}{${body}}`);
  }
  return out.join('');
}

const CSS_CACHE = new Map();
function cssFor(html){
  const used = new Set(JS_CLASSES);
  for (const [, list] of html.matchAll(/class="([^"]*)"/g))
    for (const c of list.split(/\s+/)) if (c) used.add(c);

  const key = [...used].sort().join(' ');
  if (CSS_CACHE.has(key)) return CSS_CACHE.get(key);

  let css = selectCss(RAW_CSS, used);
  // A @keyframes block survives only if a rule that was actually kept still
  // animates it — being present in the source stylesheet is not enough.
  for (const { prelude, body } of cssRules(RAW_CSS)) {
    const name = /^@keyframes\s+([\w-]+)/i.exec(prelude);
    if (name && new RegExp(`\\b${name[1]}\\b`).test(css)) css += `${prelude}{${body}}`;
  }
  const out = squash(css);
  CSS_CACHE.set(key, out);
  return out;
}

/* ───────── blog ───────── */
const BLOG_DIR = path.join(ROOT, 'content/blog');

/* Embeds a gist file inline, at the point in the article where it is being
   discussed. The content comes from gist/ — the same files the gist is
   published from — so the article, the gist and the live config cannot drift.
   GitHub's <script> embed is deliberately avoided: it is a render-blocking
   third-party request, unstyled, and would break the performance budget.

   Which lines an embed selects is decided in scripts/gist-embed.mjs, shared
   with the dev.to publisher; only the markup below is specific to the site. */
function embedGists(body, gistUrl, postFile) {
  return body.replace(GIST_RE, (_, name, anchor, from, to) => {
    const { base, content, note, lang } = resolveGistEmbed(name, anchor, from, to, postFile);
    const href = gistUrl ? `${gistUrl}#${gistAnchor(base)}` : '';
    // marked renders the fence; the surrounding markup is passed through as HTML
    return [
      `<figure class="gembed">`,
      `<figcaption><span class="gfile">${esc(base)}${note}</span>`,
      href ? `<a href="${href}" target="_blank" rel="noopener">Open in gist<svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : '',
      `</figcaption>`,
      '',
      '```' + lang,
      content,
      '```',
      '',
      `</figure>`,
      '',
    ].join('\n');
  });
}

/** minimal frontmatter: `key: value` lines, plus `tags: [a, b]` */
function frontmatter(raw){
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    /* A block list — `key:` alone on its line, then `  - ` items beneath it.
       The inline [a, b] form splits on commas, which is fine for tags and
       hopeless for anything written as prose: every change-history entry has
       a comma in it sooner or later, and the failure is a silently truncated
       list rather than an error. */
    if (v === '' && /^\s+-\s/.test(lines[i + 1] || '')) {
      const items = [];
      while (/^\s+-\s/.test(lines[i + 1] || ''))
        items.push(lines[++i].replace(/^\s+-\s+/, '').trim());
      meta[k] = items;
      continue;
    }
    if (/^\[.*\]$/.test(v)) meta[k] = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
    else if (v === 'true' || v === 'false') meta[k] = v === 'true';
    else meta[k] = v.replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

/* Today in UTC, and the only clock the publishing queue reads. Local time would
   make the laptop that wrote a post and the runner that publishes it disagree
   about what day it is, and a post is either out or it is not. */
const TODAY = new Date().toISOString().slice(0, 10);

const ALL_POSTS = (fs.existsSync(BLOG_DIR) ? fs.readdirSync(BLOG_DIR) : [])
  // files starting with _ are scaffolding, not posts (templates, notes, README)
  .filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
  .map(f => {
    const { meta, body } = frontmatter(fs.readFileSync(path.join(BLOG_DIR, f), 'utf8'));
    const words = body.split(/\s+/).filter(Boolean).length;
    if (!meta.title) throw new Error(`content/blog/${f}: missing "title" in frontmatter`);
    if (!meta.date)  throw new Error(`content/blog/${f}: missing "date" in frontmatter`);
    // The date decides when the post goes out, so a date this cannot compare is
    // a post that would silently never publish. Fail on it here instead.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.date)))
      throw new Error(`content/blog/${f}: "date" must be YYYY-MM-DD, got "${meta.date}"`);
    /* `devto` and `linkedin` are required rather than optional. They are the
       only fields here that exist to force a decision rather than to describe
       the post.

       Announcing a post is opt-in — scripts/linkedin.mjs posts nothing without
       `linkedin: true` — and the failure mode of a pure opt-in is forgetting.
       A post goes live, nobody thinks about the feed that day, and it is never
       announced. That is invisible: nothing breaks, no warning fires, and the
       post simply never leaves the site.

       A warning was the other option, and the gist `code:` card is warned about
       for a reason — there is a window where its URL genuinely does not exist
       yet. There is no equivalent window here. The answer is knowable while you
       are writing, so the build asks for it then. `false` is a real answer and
       most posts should carry it.

       `devto` was added to this gate afterwards, and the evidence for it is the
       same shape. Twenty posts shipped in one batch, all carrying `devto: true`;
       the next three, written one at a time from a template that never mentions
       the field, all dropped it and none of them was ever cross-posted. That is
       the pure-opt-in failure exactly as described above, observed rather than
       predicted. */
    if (meta.devto !== true && meta.devto !== false)
      throw new Error(
        `content/blog/${f}: missing "devto" in frontmatter — say \`devto: true\` to ` +
        `cross-post it to dev.to (canonicalised back here), or \`devto: false\` to keep it ` +
        `on this site only. See docs/cross-posting.md.`);
    if (meta.linkedin !== true && meta.linkedin !== false)
      throw new Error(
        `content/blog/${f}: missing "linkedin" in frontmatter — say \`linkedin: true\` to ` +
        `announce it on LinkedIn (with a \`linkedinText\` blurb), or \`linkedin: false\` if not. ` +
        `See docs/linkedin.md.`);
    if (meta.linkedin === true && !meta.draft && !meta.linkedinText)
      console.log(`  warn  content/blog/${f}: \`linkedin: true\` with no \`linkedinText\` — ` +
        `it will go out as its title and description, which reads like metadata.`);
    /* Post-publication edits: `changes:` is a block list of
       `YYYY-MM-DD — what changed`, newest first once sorted here.

       `updated` is derived from the newest entry rather than carried as its
       own frontmatter field. Two places holding the same date is two places
       that can disagree, and the one nobody reads is the one that goes stale.
       It is what moves dateModified and the sitemap's lastmod — a post that
       was materially revised should not go on telling Google it is untouched. */
    const changes = (meta.changes || []).map(line => {
      const c = String(line).match(/^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$/);
      if (!c) throw new Error(
        `content/blog/${f}: a change entry reads "YYYY-MM-DD — what changed", got: ${line}`);
      return { date: c[1], text: c[2].trim() };
    }).sort((a, b) => b.date.localeCompare(a.date));
    if (changes.length && changes[changes.length - 1].date < String(meta.date).slice(0, 10))
      throw new Error(`content/blog/${f}: a change is dated before the post itself (${meta.date})`);
    return {
      slug: f.replace(/\.md$/, ''),
      title: meta.title,
      date: meta.date,
      description: meta.description || '',
      tags: meta.tags || [],
      draft: meta.draft === true,
      // Optional. Orders posts that share a `date`, ascending, so a series
      // published in one go reads part 1 first. Without it the tie falls to
      // readdirSync order, which is alphabetical on macOS and unspecified on
      // the CI runner's filesystem — so the index could differ between the
      // preview and production builds of the same commit.
      order: Number.isFinite(Number(meta.order)) && String(meta.order).trim() !== ''
        ? Number(meta.order)
        : null,
      // `code:` takes a GitHub URL — a gist for a snippet, a repo for a project.
      // `repo:` is kept as an alias. The kind is detected from the URL.
      code: meta.code || meta.repo || meta.gist || '',
      codeLabel: meta.codeLabel || meta.repoLabel || '',
      changes,
      updated: changes.length ? changes[0].date : '',
      minutes: Math.max(1, Math.round(words / 200)),
      ...(() => {
        const o = outline(marked.parse(embedGists(body, meta.code || '', f), { mangle: false, headerIds: false }));
        markKeySections(o.toc, Array.isArray(meta.keySections) ? meta.keySections : [], f);
        return o;
      })(),
    };
  })
  .filter(p => !p.draft);

/* Headings carry no ids by default (`headerIds: false`), so the table of
   contents has nothing to link to. This adds them, and returns the outline it
   found in the same pass — one walk, and the ids in the page and the ids in the
   nav can never disagree because they are produced together.

   Duplicate headings get -2, -3 suffixes. Two sections called "Questions" would
   otherwise both own #questions, and the second would be unreachable. */
function outline(html){
  const seen = new Map();
  const toc = [];
  const out = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<')
                      .replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
    let id = text.toLowerCase()
      .replace(/[\u2018\u2019\u201c\u201d]/g,'')
      .replace(/[^a-z0-9]+/g,'-')
      .replace(/^-+|-+$/g,'') || 'section';
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    toc.push({ level: Number(lvl), id, text });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });
  return { html: out, toc };
}

/* `keySections:` in the frontmatter promotes headings in the contents list —
   the two or three a reader is actually hunting for, usually "how do I install
   it". The author decides, because nothing in the markup can tell which
   section someone came for.

   A name that matches nothing fails the build. The alternative is a typo that
   silently highlights nothing, which is the worst kind of feature: one you
   believe is on. */
function markKeySections(toc, names, file){
  if (!names.length) return toc;
  const norm = t => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const name of names) {
    const want = norm(String(name));
    const hits = toc.filter(h => norm(h.text) === want || norm(h.text).includes(want));
    if (!hits.length)
      throw new Error(
        `content/blog/${file}: keySections lists "${name}", which matches no heading. ` +
        `Headings in this post: ${toc.map(h => `"${h.text}"`).join(', ')}`);
    if (hits.length > 1)
      throw new Error(
        `content/blog/${file}: keySections entry "${name}" matches ${hits.length} headings ` +
        `(${hits.map(h => `"${h.text}"`).join(', ')}). Use the full heading text.`);
    hits[0].key = true;
  }
  return toc;
}

/* A post dated in the future is finished, reviewed and merged — it just has not
   come out yet. It is held exactly as a draft is: off the index, the sitemap and
   the feed, so nothing ever links to a page that does not answer. Nobody has to
   come back and flip a flag on the day: ci-cd.yml rebuilds daily, and this
   filter lets the post through on the first build after its date. */
// Newest first; then `order` ascending for a series; then slug, so the result
// never depends on the order the filesystem happened to list the directory in.
// MAX_SAFE_INTEGER rather than Infinity: Infinity - Infinity is NaN, which a
// comparator reads as "equal" and silently drops back to filesystem order.
const byNewest = (a, b) => {
  const rank = p => (p.order === null ? Number.MAX_SAFE_INTEGER : p.order);
  return b.date.localeCompare(a.date)
      || rank(a) - rank(b)
      || a.slug.localeCompare(b.slug);
};

const SCHEDULED = ALL_POSTS.filter(p => p.date > TODAY).sort(byNewest);
const POSTS     = ALL_POSTS.filter(p => p.date <= TODAY).sort(byNewest);

/* A post nobody can look at is a post nobody can review, and the PR that merges
   it is the only place anyone would. So a preview build renders the held ones
   too — marked as held, and `noindex` so a leaked preview URL cannot be indexed
   ahead of the real page. They stay out of the sitemap and the feed either way.

   The production deploy takes the artifact this build job uploads, so the flag
   is what separates the preview from what ships: ci-cd.yml sets it on pull
   requests only, which are exactly the runs that cannot deploy production. */
const PREVIEW = process.env.PREVIEW_SCHEDULED === '1';
const VISIBLE = PREVIEW ? [...SCHEDULED, ...POSTS].sort(byNewest) : POSTS;

for (const p of SCHEDULED) console.log(
  `  held  /blog/${p.slug}/ — publishes ${p.date}${PREVIEW ? ' (rendered for preview)' : ''}`);

/* The publishing calendar — how many posts a day may carry, which day is off,
   and which slot each post claimed. It is a rule about the source rather than
   the output, so it is enforced here rather than in verify.mjs: CI runs the
   build first, and a post on a day that cannot hold it should stop the branch
   before a page is written for it.

   The rule lives in scripts/schedule-rule.mjs and is read by the allocator from
   the same file, so a slot `npm run schedule -- --claim` hands out can never be
   one this refuses. Posts predating `rule.from` are not checked: the archive was
   published before the rule existed, and re-dating pages Google has already
   crawled to satisfy it would cost more than the tidiness is worth. */
{
  const { errors, warnings, overrides } = calendarViolations();
  for (const o of overrides) console.log(`  override  ${o}`);
  for (const w of warnings)  console.warn(`  warn  calendar: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ERROR  calendar: ${e}`);
    throw new Error(`the publishing calendar refuses ${errors.length} post(s) — see above`);
  }
}

/* Every gist declares the post it links back to (scripts/build-gist.mjs). That
   post should carry a `code:` card pointing the other way, or the gist is
   published and nothing on the site sends anyone to it. A warning rather than
   an error, because there is a real window — between merging the post and the
   sync workflow creating the gist — where the URL does not exist yet. */
{
  const manifest = path.join(GIST_DIR, 'gists.json');
  if (fs.existsSync(manifest)) {
    for (const g of JSON.parse(fs.readFileSync(manifest, 'utf8'))) {
      for (const slug of g.posts ?? [g.post]) {
        const post = POSTS.find(p => p.slug === slug);
        if (!post) continue;                     // draft, held or renamed; build-gist.mjs guards that
        if (!post.code) console.warn(
          `  warn  gist/${g.dir}/ links to /blog/${slug}/, but that post has no \`code:\` field ` +
          `— add the gist URL so readers can find it.`);
      }
    }
  }
}

const humanDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB',
  { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ───────── ASO reports ───────── */
/* A second content type, deliberately not a blog post. An issue is mostly a
   table, it is dated by the month it measures rather than by the day somebody
   felt like writing, and its numbers come out of a database this build cannot
   reach. So it gets its own directory, its own route and its own rules instead
   of three special cases inside the post pipeline.

   The numbers live in _source/aso/<slug>.json, written by `npm run aso` on a
   machine that can see the ideaminer analytics database and committed with the
   issue. CI has no route to that database and never will — a build that
   queried it would pass on a laptop and fail on the runner. See the header of
   scripts/aso.mjs.

   Issues stay out of the publishing calendar on purpose. That calendar paces
   writing, and it draws a quota so a person does not have to decide; a monthly
   data report has its own cadence and would only ever be competing with posts
   for slots it does not need. */
const ASO_DIR  = path.join(ROOT, 'content/aso');
const ASO_SNAP = path.join(ROOT, '_source/aso');

const MONTH_NAME = ym => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB',
    { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/* Installs come off Play as an order of magnitude, not a count — 1000000 means
   "somewhere past a million". Printing it with separators would claim a
   precision the source does not have. */
const installs = n => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return `${n / 1e9}B+`;
  if (n >= 1e6) return `${n / 1e6}M+`;
  if (n >= 1e3) return `${n / 1e3}k+`;
  return `${n}+`;
};

/* How long the current number one has been on Play. Years past two, because
   "3,844 days" is a number a reader has to convert before it means anything,
   and the point of the column is how entrenched the holder is. */
const heldFor = d => {
  if (d === null || d === undefined) return '—';
  return d >= 730 ? `${(d / 365).toFixed(1)} yrs` : `${d} d`;
};

/* Demand arrives as a 0–1 confidence-blended score. It is shown out of 100
   because that is how a reader reads a score, and it is never called volume:
   it ranks terms against each other, it does not estimate searches. */
const demandScore = d => Math.round(d * 100);

const ALL_ASO = (fs.existsSync(ASO_DIR) ? fs.readdirSync(ASO_DIR) : [])
  .filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
  .map(f => {
    const { meta, body } = frontmatter(fs.readFileSync(path.join(ASO_DIR, f), 'utf8'));
    const slug = f.replace(/\.md$/, '');
    if (!meta.title) throw new Error(`content/aso/${f}: missing "title" in frontmatter`);
    if (!meta.date)  throw new Error(`content/aso/${f}: missing "date" in frontmatter`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.date)))
      throw new Error(`content/aso/${f}: "date" must be YYYY-MM-DD, got "${meta.date}"`);

    /* The snapshot is the page. Without it there is no report — so this is an
       error naming the command that produces the file, not a warning. */
    const dataSlug = meta.data || slug;
    const snap = path.join(ASO_SNAP, `${dataSlug}.json`);
    if (!fs.existsSync(snap)) throw new Error(
      `content/aso/${f}: no data snapshot at _source/aso/${dataSlug}.json — ` +
      `run \`npm run aso -- --harvest <category>\` on a machine that can reach the ` +
      `analytics database, and commit the JSON with the issue.`);
    const data = JSON.parse(fs.readFileSync(snap, 'utf8'));

    return {
      slug,
      title: meta.title,
      date: meta.date,
      description: meta.description || '',
      draft: meta.draft === true,
      /* Orders issues sharing a date, ascending — the same field a post series
         uses. It matters here because a month's run can go out several on one
         day, and without it the tie falls to slug, which would open the run on
         "arcade" for no reason other than the alphabet. */
      order: Number.isFinite(Number(meta.order)) && String(meta.order).trim() !== ''
        ? Number(meta.order)
        : null,
      data,
      ...outline(marked.parse(body, { mangle: false, headerIds: false })),
    };
  })
  .filter(i => !i.draft)
  /* Newest first, then `order` ascending, then slug — so the result never
     depends on the order the filesystem happened to list the directory in,
     which differs between macOS and the CI runner. MAX_SAFE_INTEGER rather than
     Infinity: Infinity - Infinity is NaN, which a comparator reads as "equal"
     and silently drops back to filesystem order. */
  .sort((a, b) => {
    const rank = i => (i.order === null ? Number.MAX_SAFE_INTEGER : i.order);
    return b.date.localeCompare(a.date) || rank(a) - rank(b) || a.slug.localeCompare(b.slug);
  });

/* Held exactly as a post is, and for the same reason: an issue dated ahead is
   finished and merged, and the daily build puts it out without anyone flipping
   a flag on the day. ASO_LIVE is what the sitemap may claim exists; ASO_VISIBLE
   additionally renders the held ones on a preview build so a PR can be read. */
/* The Rankgrip page — the canonical definition of the score every report uses.
   It is `_rankgrip.md` so the issue loader above skips it — a
   leading underscore already means "not a post" everywhere else in this repo —
   and it is read here by name instead.

   It exists because the alternative was printing the same six hundred words of
   methodology at the bottom of every issue. At one issue a month across six
   categories that is seventy-two copies a year of identical text, which is the
   pattern Google's scaled-content-abuse policy describes and, separately, a
   waste of the reader's scroll. One canonical page can also answer the question
   the reports get asked most — why there is no search volume column — properly
   rather than in a bullet.

   It is also the thing that makes the score citable. A metric with one permanent
   URL, a published formula and a name nobody else uses can be quoted and linked;
   an unnamed methodology repeated across seventy pages cannot. */
const ASO_RANKGRIP = (() => {
  const f = path.join(ASO_DIR, '_rankgrip.md');
  if (!fs.existsSync(f)) return null;
  const { meta, body } = frontmatter(fs.readFileSync(f, 'utf8'));
  if (!meta.title) throw new Error('content/aso/_rankgrip.md: missing "title" in frontmatter');
  return {
    title: meta.title,
    description: meta.description || '',
    date: meta.date || TODAY,
    ...outline(marked.parse(body, { mangle: false, headerIds: false })),
  };
})();

const ASO_LIVE      = ALL_ASO.filter(i => i.date <= TODAY);
const ASO_SCHEDULED = ALL_ASO.filter(i => i.date > TODAY);
const ASO_VISIBLE   = PREVIEW ? ALL_ASO : ASO_LIVE;
for (const i of ASO_SCHEDULED) console.log(
  `  held  /aso/${i.slug}/ — publishes ${i.date}${PREVIEW ? ' (rendered for preview)' : ''}`);

/* ───────── shared chrome ───────── */
const LOGO = (s=30) => `<svg width="${s}" height="${s}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC53D"/><stop offset="1" stop-color="#FF2D8E"/></linearGradient></defs>
<rect x="4" y="4" width="40" height="40" rx="12" fill="url(#lg)"/>
<path d="M17 32V16h5.6c4.6 0 7.4 3 7.4 8s-2.8 8-7.4 8H17Zm4.6-3.6h.9c2.3 0 3.7-1.6 3.7-4.4s-1.4-4.4-3.7-4.4h-.9v8.8Z" fill="#20100A"/></svg>`;
const PLAY_ICON = `<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.6 2.3 13.8 12 3.6 21.7c-.4-.2-.6-.6-.6-1.1V3.4c0-.5.2-.9.6-1.1Zm11.6 8.3L5.8 1.8l11.6 6.6-2.2 2.2Zm0 2.8 2.2 2.2-11.6 6.6 9.4-8.8Zm1.4-1.4 2.9-1.7c.7-.4.7-1.4 0-1.8l-2.9-1.7L14.2 12l2.4 2.4Z"/></svg>`;
const TICK = `<svg aria-hidden="true" class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const NAV = cur => `
<header class="nav" id="nav"><div class="shell nav-in">
  <a href="/" class="brand">${LOGO(30)} Indie Core Dev</a>
  <nav class="nav-links" aria-label="Primary">
    <a href="/#games"${cur==='games'?' aria-current="page"':''}>Games</a>
    <a href="/blog/"${cur==='blog'?' aria-current="page"':''}>Blog</a>
    <a href="/aso/"${cur==='aso'?' aria-current="page"':''}>ASO reports</a>
    <a href="/subscribe/?from=nav"${cur==='subscribe'?' aria-current="page"':''}>Newsletter</a>
    <a href="/about/"${cur==='about'?' aria-current="page"':''}>About</a>
    <a href="/privacy/"${cur==='privacy'?' aria-current="page"':''}>Privacy</a>
    <a href="/contact/"${cur==='contact'?' aria-current="page"':''}>Contact</a>
    <a class="btn btn-primary btn-sm" href="/#games">Get the games</a>
  </nav>
  <button class="burger" aria-label="Menu" aria-expanded="false" aria-controls="mobmenu"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFF6E9" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
</div>
<nav class="mobmenu" id="mobmenu" aria-label="Primary, compact">
  <a href="/#games">Games</a><a href="/blog/">Blog</a><a href="/aso/">ASO reports</a><a href="/subscribe/?from=nav">Newsletter</a><a href="/about/">About</a><a href="/privacy/">Privacy</a><a href="/contact/">Contact</a><a href="/legal/">Legal</a>
</nav></header>`;

const FOOT = `
<footer class="foot"><div class="shell">
  <div class="foot-grid">
    <div>
      <a href="/" class="brand" style="font-size:16px">${LOGO(28)} Indie Core Dev</a>
      <p style="margin:18px 0 0;font-size:14.5px;color:var(--muted);max-width:300px">Free puzzle games for Android, made in France by Othmane Ettaib.</p>
    </div>
    <div><h2 class="foot-h">Games</h2><ul>
      ${ALL.map(g=>`<li><a href="/games/${g.slug}/">${esc(g.name)}${g.live?'':' — soon'}</a></li>`).join('')}
    </ul></div>
    <div><h2 class="foot-h">Privacy policies</h2><ul>
      ${/* The column heading is not part of a link's accessible name, so
            without the suffix each game is announced twice, identically, once
            for the game page and once for the policy. */''}
      ${ALL.map(g=>`<li><a href="/privacy/${g.slug}/">${esc(g.name)}<span class="sr-only"> privacy policy</span></a></li>`).join('')}
    </ul></div>
    <div><h2 class="foot-h">Studio</h2><ul>
      <li><a href="/blog/">Blog</a></li>
      <li><a href="/aso/">ASO reports</a></li>
      <li><a href="/subscribe/?from=footer">Mailing list</a></li>
      <li><a href="/about/">About</a></li>
      <li><a href="/contact/">Contact</a></li>
      <li><a href="https://github.com/IndieCoreDev" target="_blank" rel="noopener">GitHub</a></li>
      <li><a href="mailto:${EMAIL}">${EMAIL}</a></li>
    </ul></div>
  </div>
  <div class="foot-bot">
    <span>SIREN ${LEGAL.siren} · APE 6201Z · ${LEGAL.address}</span>
    <span>© 2026 Othmane Ettaib — Indie Core Dev <span class="ver" title="Build ${BUILD.sha} · ${BUILD.date}">v${BUILD.version}</span></span>
  </div>
</div></footer>
<script type="speculationrules">
{"prefetch":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/*.xml"}},{"not":{"href_matches":"/subscribe/thanks/*"}},{"not":{"href_matches":"/subscribe/confirmed/*"}}]},"eagerness":"moderate"}]}
</script>
<script src="/assets/${APP_FILE}" defer></script>`;

function layout({title, desc, canonical, body, cur, jsonld, ogimg, noindex}){
  const og = SITE + (ogimg || '/assets/og/default.jpg');
  // Assembled before the head so the inlined CSS can be chosen from the
  // markup this page actually contains.
  const markup = `<a class="skip" href="#main">Skip to content</a>
<div class="aurora"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>
<div class="grain"></div>
${NAV(cur)}
<main id="main">
${body}
</main>
${INVITE(canonical)}
${FOOT}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${canonical}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Indie Core Dev">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${og}">
<meta name="theme-color" content="#0B0616">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n<link rel="alternate" type="application/rss+xml" title="Indie Core Dev — Blog" href="/blog/feed.xml">
${FONT_PRELOAD}
<style>${FONT_CSS}</style>
<style>${cssFor(markup)}</style>
${(Array.isArray(jsonld) ? jsonld : jsonld ? [jsonld] : []).map(b => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n')}
</head>
<body>
${markup}
</body>
</html>`;
}

/* The mailing-list invitation. Ships hidden and stays hidden until app.js
   decides someone is actually reading, so with JavaScript off it never
   appears at all — which is the correct behaviour, not a degradation.

   Kept off the pages where it would be either redundant or tone-deaf: the
   signup flow itself, and the two documents that explain what this site does
   with your data. Asking for an address in the middle of a privacy policy is
   the exact move the rest of this site is built against. */
const INVITE_SKIP = ['/subscribe/', '/privacy/', '/legal/'];
const INVITE = canonical => INVITE_SKIP.some(p => canonical.startsWith(p)) ? '' : `
<aside class="ml-invite" id="mlInvite" hidden aria-labelledby="mlInviteH">
  <button class="ml-invite-x" type="button" data-ml-close aria-label="Dismiss, and do not show this again">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>
  <h2 class="ml-invite-h" id="mlInviteH">Hear when the next game ships</h2>
  <p class="ml-invite-p">A few emails a year. One click to leave.</p>
  <a class="btn btn-primary btn-sm" href="/subscribe/?from=invite" data-ml-go>Join the mailing list</a>
</aside>`;

const crumbLD = items => ({'@context':'https://schema.org','@type':'BreadcrumbList',
  itemListElement: items.map((it,i) => ({'@type':'ListItem', position:i+1, name:it[0], item:SITE+it[1]}))});

/* ───────── page: home ───────── */
function gameRow(g, i){
  const media = g.live && g.shots.length
    ? `<div><div class="gallery" data-gallery><div class="scr">
         ${/* Only the visible slide is announced. app.js moves this as the
               carousel turns; emitting it here keeps it correct with JS off,
               where the others never become visible at all. */''}
         ${g.shots.slice(0,4).map((s,n)=>`<img${n?' aria-hidden="true"':' class="on"'} src="/assets/games/${s}" alt="${esc(g.name)} screenshot ${n+1}" loading="lazy">`).join('')}
       </div></div><div class="gdots"></div></div>`
    : `<div class="gallery"><div class="scr" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#241442,#140A26)">
         <svg aria-hidden="true" width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.1" stroke-linecap="round" opacity=".8"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9h3M8 13h8M8 17h5"/></svg>
       </div></div>`;
  const cta = g.live
    ? `<img class="gicon" src="/assets/games/${g.icon}" alt="${esc(g.name)} app icon" width="56" height="56">
       <a class="btn btn-primary" href="${g.playUrl}" target="_blank" rel="noopener">${PLAY_ICON} Play free<span class="sr-only"> — ${esc(g.name)}</span></a>
       <a class="btn btn-ghost" href="/games/${g.slug}/">Learn more<span class="sr-only"> about ${esc(g.name)}</span></a>`
    : `<span class="soon"><span class="dot"></span> Coming soon</span>
       <a class="btn btn-ghost" href="/games/${g.slug}/">Learn more<span class="sr-only"> about ${esc(g.name)}</span></a>`;
  return `<article class="game rv${i%2?' flip':''}">
  <div class="game-media"><div class="halo"></div>${media}</div>
  <div class="game-body">
    <span class="gtag">${esc(g.category)}${g.live?'':' · in development'}</span>
    <h3>${esc(g.name)}</h3>
    <p>${esc(g.blurb)}</p>
    <ul class="feats">${g.feats.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>
    <div class="game-cta">${cta}</div>
  </div>
</article>`;
}

const WHY = [
  ['Nothing to buy','Not one of our games sells an in-app purchase. Every level, power-up and coin is earned by playing. There is no premium tier waiting to ambush you.',
   `<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/><path d="m3 3 18 18"/>`],
  ['Nothing to sign up for','No account to create, no email to hand over, no personal data collected. You open the game and you play it — and every title ships with a privacy policy you can read in two minutes.',
   `<path d="M12 3 4 6.5v5c0 4.6 3.3 8.7 8 9.5 4.7-.8 8-4.9 8-9.5v-5L12 3Z"/><path d="m9 12 2 2 4-4"/>`],
  ['Nothing to connect to','Planes, metros, dead zones, basements. The games keep working without a signal — progress saves on your device first and syncs later if it needs to.',
   `<path d="M5 12.5a7 7 0 0 1 14 0"/><path d="M2 9a11 11 0 0 1 20 0"/><circle cx="12" cy="17.5" r="2"/><path d="m3 3 18 18"/>`],
];

function pageHome(){
  const marq = `<div class="marq-item">${ALL.map(g=>`<span>${esc(g.name)}${g.live?'':' — soon'}</span><i></i>`).join('')}</div>`;
  const body = `
<section class="hero"><div class="shell hero-grid">
  <div>
    <div class="chip rv"><span class="dot"></span> ${GAMES.length} games live · 100% free</div>
    <h1 class="rv">FIVE PUZZLES.<br><span class="grad">ZERO PAYWALLS.</span></h1>
    <p class="lede rv">Free puzzle games for Android that never ask for your wallet. No in-app purchases, no sign-up, and every one of them works without a signal.</p>
    <div class="cta-row rv">
      <a class="btn btn-primary" href="#games">${PLAY_ICON} Browse the games</a>
      <a class="btn btn-ghost" href="/about/">About the studio</a>
    </div>
    <div class="trust rv">
      <span>${TICK} No in-app purchases</span><span>${TICK} No sign-up</span><span>${TICK} Plays offline</span>
    </div>
  </div>
  <div class="phones" id="phones">
    <div class="glowpad"></div>
    <div class="phone p2" data-depth="26"><div class="scr"><img data-hero fetchpriority="low" src="/assets/games/color-block-puzzle-master-02.jpg" alt="Color Block Puzzle Master gameplay" loading="lazy"></div></div>
    <div class="phone p3" data-depth="20"><div class="scr"><img data-hero fetchpriority="low" src="/assets/games/word-slot-01.jpg" alt="Word Slot: Fill-In Crossword gameplay" loading="lazy"></div></div>
    <div class="phone p1" data-depth="42"><div class="scr"><img data-hero src="/assets/games/soda-jam-02.jpg" alt="Soda Jam: Color Sort gameplay" width="250" height="444" fetchpriority="high"></div></div>
  </div>
</div></section>

<div class="shell"><div class="marq"><div class="marq-track">${marq}${marq.replace('<div class="marq-item">','<div class="marq-item" aria-hidden="true">')}</div></div></div>

<section class="sec" id="games"><div class="shell">
  <div class="sec-head rv">
    <span class="eyebrow">The catalogue</span>
    <h2>Pick your next obsession.</h2>
    <p>Five games on Google Play right now. Every one of them free, start to finish.</p>
  </div>
  ${ALL.map(gameRow).join('\n')}
</div></section>

<section class="sec" id="why"><div class="shell">
  <div class="sec-head rv">
    <span class="eyebrow">Why our games</span>
    <h2>The stuff you&rsquo;d want us to promise, promised.</h2>
    <p>Free-to-play has a bad name for good reasons. Here is what we don&rsquo;t do.</p>
  </div>
  <div class="why">
    ${WHY.map(([h,p,ico])=>`<div class="wcard rv" data-tilt>
      <div class="wico"><svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${ico}</svg></div>
      <h3>${h}</h3><p>${p}</p></div>`).join('')}
  </div>
</div></section>

<section class="sec" id="studio"><div class="shell">
  <div class="band rv">
    <h2>Made by one person.<br>Played all over the world.</h2>
    <p>Indie Core Dev is the studio of Othmane Ettaib, founded in France in April 2025. Every line of code, every level and every pixel is made here.</p>
    <div class="band-icons">
      ${GAMES.filter(g=>g.icon).map(g=>`<a href="/games/${g.slug}/" title="${esc(g.name)}"><img src="/assets/games/${g.icon}" alt="${esc(g.name)}" width="74" height="74"></a>`).join('')}
    </div>
    <div class="cta-row" style="justify-content:center">
      <a class="btn btn-primary" href="/about/">About the studio</a>
      <a class="btn btn-ghost" href="/contact/">Get in touch</a>
    </div>
  </div>
</div></section>

<section class="sec-tight"><div class="shell narrow">
  <div class="band rv">
    <span class="eyebrow">Mailing list</span>
    <h2>Hear when the next one ships.</h2>
    <p>A handful of emails a year &mdash; a new game, a real update to one, or a note about
    building them. One click to leave, from any of them.</p>
    <div class="cta-row" style="justify-content:center">
      <a class="btn btn-primary" href="/subscribe/?from=home">Join the mailing list</a>
    </div>
  </div>
</div></section>`;
  return layout({
    title:'Indie Core Dev — Free puzzle games for Android',
    desc:'Five free puzzle games for Android with no in-app purchases, no sign-up and offline play. Made in France by Indie Core Dev.',
    canonical:'/', cur:'games', body,
    ogimg:'/assets/og/home.jpg',
    jsonld:[{'@context':'https://schema.org','@type':'Organization',name:'Indie Core Dev',url:SITE,email:EMAIL,
      logo:SITE+'/favicon.svg',
      founder:{'@type':'Person',name:'Othmane Ettaib'},foundingDate:'2025-04',
      address:{'@type':'PostalAddress',streetAddress:LEGAL.street,postalCode:LEGAL.postalCode,addressLocality:LEGAL.city,addressCountry:'FR'}},
     {'@context':'https://schema.org','@type':'WebSite',name:'Indie Core Dev',url:SITE},
     {'@context':'https://schema.org','@type':'ItemList',name:'Games by Indie Core Dev',
      itemListElement: ALL.map((g,i)=>({'@type':'ListItem',position:i+1,name:g.name,url:SITE+'/games/'+g.slug+'/'}))}],
  });
}

/* ───────── page: game detail ───────── */
function pageGame(g){
  const others = ALL.filter(x => x.slug !== g.slug);
  const metaRows = [
    ['Category', g.category],
    ['Content rating', g.contentRating],
    ['Updated', g.updated],
    ['In-app purchases', 'None'],
  ].filter(([, v]) => v);            // a game with no listing has no rating or update date
  const body = `
<section class="ghero"><div class="shell ghero-grid">
  <div>
    <nav class="crumb rv" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/#games">Games</a> <span>/</span> <span style="color:var(--text)">${esc(g.name)}</span></nav>
    <div class="ghead rv">
      ${g.icon?`<img src="/assets/games/${g.icon}" alt="${esc(g.name)} app icon" width="88" height="88">`:''}
      <div><span class="gtag">${esc(g.category)}${g.live?'':' · in development'}</span><h1 style="margin-top:12px">${esc(g.name)}</h1></div>
    </div>
    <p class="lede rv">${esc(g.tagline)}</p>
    <div class="cta-row rv">
      ${g.live
        ? `<a class="btn btn-primary" href="${g.playUrl}" target="_blank" rel="noopener">${PLAY_ICON} Get it on Google Play</a>`
        : `<span class="soon"><span class="dot"></span> Coming soon to Google Play</span>
           <a class="btn btn-primary" href="/subscribe/?from=${g.slug}">Tell me when it ships</a>`}
      <a class="btn btn-ghost" href="/privacy/${g.slug}/">Privacy policy</a>
    </div>
    <div class="trust rv"><span>${TICK} Free to play</span><span>${TICK} No purchases</span>${g.offline===false?'':`<span>${TICK} Plays offline</span>`}</div>
    <dl class="meta rv">${metaRows.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  </div>
  <div class="game-media rv"><div class="halo"></div>
    ${g.shots.length ? `<div><div class="gallery" data-gallery><div class="scr">
      ${/* The first slide is the LCP element on a game page — the same treatment
            the home page already gives its centre phone. Without the hint the
            browser discovers it at default priority behind the rest of the
            head, which measured as a reproducible 0.26s of LCP. */''}
      ${g.shots.map((s,n)=>`<img${n?' aria-hidden="true"':' class="on" fetchpriority="high"'} src="/assets/games/${s}" alt="${esc(g.name)} screenshot ${n+1}"${n?' loading="lazy"':''}>`).join('')}
    </div></div><div class="gdots"></div></div>`
    : `<div class="gallery"><div class="scr" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#241442,#140A26)">
         <svg aria-hidden="true" width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.1" stroke-linecap="round" opacity=".8"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9h3M8 13h8M8 17h5"/></svg></div></div>`}
  </div>
</div></section>

${g.feature ? `<section class="sec-keyart"><div class="shell">
  <div class="keyart rv"><img src="/assets/games/${g.feature}" alt="${esc(g.name)} key art" loading="lazy" decoding="async"></div>
</div></section>` : ''}

${g.shots.length > 1 ? `<section class="sec-shots"><div class="shell">
  <div class="sec-head rv" style="margin-bottom:34px">
    <span class="eyebrow">Screenshots</span>
    <h2>Straight from the game</h2>
  </div>
  <div class="shots rv" style="--cols:${gridCols(g.shots.length)};--max:${gridMax(g.shots.length)}px" data-lightbox>
    ${g.shots.map((s,n)=>`<button class="shot" type="button" data-i="${n}" aria-label="Enlarge screenshot ${n+1} of ${g.shots.length}">
      <span class="scr"><img data-shot="${gridCols(g.shots.length)}:${gridMax(g.shots.length)}" src="/assets/games/${s}" alt="${esc(g.name)} screenshot ${n+1}" loading="lazy"></span>
      <span class="zoom"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8.5v5M8.5 11h5"/></svg></span>
    </button>`).join('')}
  </div>
</div></section>` : ''}

${g.video ? `<section class="sec-tight"><div class="shell">
  <div class="sec-head rv" style="margin-bottom:30px"><span class="eyebrow">Trailer</span><h2>See it in motion</h2></div>
  <button class="trailer rv" type="button" data-trailer="${g.video}" aria-label="Play the ${esc(g.name)} gameplay trailer">
    <img src="/assets/games/${g.feature}" alt="${esc(g.name)} key art" aria-hidden="true" loading="lazy" decoding="async">
    <span class="tplay"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg></span>
    <span class="tnote">Watch on YouTube &middot; nothing loads until you press play</span>
  </button>
  <p class="tconsent rv">Pressing play loads the video from <b>youtube-nocookie.com</b> and sends your IP
  address and device information to Google, who become responsible for it. Nothing else on this page
  depends on the video. <a href="/privacy/">What this site does with data</a></p>
</div></section>` : ''}

<section class="sec-tight"><div class="shell">
  <div class="sec-head rv" style="margin-bottom:32px"><span class="eyebrow">About this game</span><h2>What you&rsquo;re getting into</h2></div>
  <div class="prose rv">${g.desc ? renderDesc(g.desc) : `<p>${esc(g.blurb)}</p>`}</div>
  <ul class="feats rv" style="margin-top:26px">${g.feats.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>
  ${g.live?`<div class="cta-row rv"><a class="btn btn-primary" href="${g.playUrl}" target="_blank" rel="noopener">${PLAY_ICON} Play ${esc(g.name)} free</a><a class="btn btn-ghost" href="/subscribe/?from=${g.slug}">Hear about updates</a></div>`:''}
</div></section>

<section class="sec"><div class="shell">
  <div class="sec-head rv" style="margin-bottom:32px"><span class="eyebrow">More from the studio</span><h2>Other games</h2></div>
  <div class="grid4">
    ${others.map(o=>`<a class="mini rv" href="/games/${o.slug}/">
      ${o.icon?`<img src="/assets/games/${o.icon}" alt="${esc(o.name)} app icon" aria-hidden="true" width="60" height="60">`:'<div style="width:60px;height:60px;border-radius:16px;margin-bottom:16px;border:1px dashed rgba(255,255,255,.26)"></div>'}
      <h3>${esc(o.name)}</h3><span>${esc(o.category)}${o.live?'':' · soon'}</span></a>`).join('')}
  </div>
</div></section>`;
  return layout({
    title:`${g.name} — free ${String(g.category).toLowerCase()} game for Android`,
    desc:`${g.tagline} Free on Google Play — no in-app purchases, no sign-up, plays offline.`,
    canonical:`/games/${g.slug}/`, cur:'games', body,
    ogimg:fs.existsSync(path.join(ROOT, `public/assets/og/${g.key}.jpg`))
      ? `/assets/og/${g.key}.jpg` : '/assets/og/default.jpg',
    jsonld:[{'@context':'https://schema.org','@type':'VideoGame',name:g.name,
      applicationCategory:'GameApplication',operatingSystem:'Android',
      description:g.tagline, genre:g.category, url:SITE+`/games/${g.slug}/`,
      image: g.icon ? SITE+`/assets/games/${g.icon}` : SITE+'/favicon.svg',
      screenshot: g.shots.map(sh => SITE+`/assets/games/${sh}`),
      contentRating:g.contentRating,
      ...(g.live?{installUrl:g.playUrl, downloadUrl:g.playUrl}:{}),
      offers:{'@type':'Offer',price:'0',priceCurrency:'USD',availability:'https://schema.org/InStock'},
      author:{'@type':'Organization',name:'Indie Core Dev',url:SITE},
      publisher:{'@type':'Organization',name:'Indie Core Dev',url:SITE}},
     crumbLD([['Home','/'],['Games','/#games'],[g.name,`/games/${g.slug}/`]])],
  });
}

/* ───────── page: privacy doc ───────── */
function pagePrivacy(g){
  const {meta, sections} = parsePolicy(g.legacy);
  const body = `
<div class="shell doc">
  <nav class="toc" aria-label="On this page">
    <div class="toc-h">Contents</div>
    <ol>${sections.map(s=>`<li><a href="#s${s.num}"><i>${String(s.num).padStart(2,'0')}</i><span>${esc(s.head)}</span></a></li>`).join('')}</ol>
  </nav>
  <div>
    <div class="doc-head">
      <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/privacy/">Privacy</a> <span>/</span> <span style="color:var(--text)">${esc(g.name)}</span></nav>
      <span class="eyebrow">Privacy policy</span>
      <h1>${esc(g.name)}</h1>
      <div class="doc-meta">
        ${meta.pkg?`<span>Package: ${esc(meta.pkg)}</span>`:''}
        ${meta.effective?`<span>Effective: ${esc(meta.effective)}</span>`:''}
        ${meta.updated?`<span>Updated: ${esc(meta.updated)}</span>`:''}
        <span>Contact: <a href="mailto:${EMAIL}" style="color:var(--accent)">${EMAIL}</a></span>
      </div>
    </div>
    <div class="doc-body">
      ${sections.map(s=>`<section id="s${s.num}"><h2><i>${String(s.num).padStart(2,'0')}</i>${esc(s.head)}</h2>${renderBlocks(s.blocks)}</section>`).join('')}
    </div>
    <div class="cta-row" style="margin-top:48px">
      ${g.policyOnly ? '' : `<a class="btn btn-ghost" href="/games/${g.slug}/">Back to ${esc(g.name)}</a>`}
      <a class="btn btn-ghost" href="/privacy/">All privacy policies</a>
    </div>
  </div>
</div>`;
  return layout({
    title:`Privacy Policy — ${g.name} — Indie Core Dev`,
    desc:`Privacy policy for ${g.name}: what the game collects, what it never collects, and how to delete your data.`,
    canonical:`/privacy/${g.slug}/`, cur:'privacy', body,
    ogimg:fs.existsSync(path.join(ROOT, `public/assets/og/${g.key}.jpg`))
      ? `/assets/og/${g.key}.jpg` : '/assets/og/default.jpg',
    jsonld:[crumbLD([['Home','/'],['Privacy','/privacy/'],[g.name,`/privacy/${g.slug}/`]])],
  });
}

/* ───────── page: blog ───────── */
function postCard(p){
  // The held pill only ever appears on a preview build; the index that ships
  // has nothing to mark. It sits in the same row as the tags because that row
  // already has the pill styling — a marker needing its own CSS to say one word
  // is not worth the rule.
  const pills = [
    p.date > TODAY ? `<span class="tcode">Publishes ${humanDate(p.date)}</span>` : '',
    ...p.tags.map(t => `<span>${esc(t)}</span>`),
    p.code ? `<span class="tcode">${/gist\.github\.com/.test(p.code) ? 'gist' : 'code'}</span>` : '',
  ].filter(Boolean);
  return `<a class="pcard rv" href="/blog/${p.slug}/">
    <div class="pmeta"><time datetime="${p.date}">${humanDate(p.date)}</time><span>·</span><span>${p.minutes} min read</span></div>
    <h2>${esc(p.title)}</h2>
    ${p.description ? `<p>${esc(p.description)}</p>` : ''}
    ${pills.length ? `<div class="ptags">${pills.join('')}</div>` : ''}
    <span class="plink">Read<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg></span>
  </a>`;
}

function pageBlogIndex(){
  const body = `
<section class="hero" style="padding-bottom:32px"><div class="shell narrow">
  <span class="eyebrow">Blog</span>
  <h1 style="font-size:clamp(38px,5.6vw,68px)">Notes from<br><span class="grad">the studio.</span></h1>
  <p class="lede">Game updates, what goes on behind them, and the occasional technical write-up — from the person building them.</p>
  <div class="cta-row rv" style="margin-top:22px">
    <a class="btn btn-primary" href="/subscribe/?from=blog">Get new posts by email</a>
  </div>
  <p style="margin-top:18px"><a class="rsslink" href="/blog/feed.xml">
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="6.2" cy="17.8" r="2.2"/><path d="M4 10.5v3a6.5 6.5 0 0 1 6.5 6.5h3A9.5 9.5 0 0 0 4 10.5Z"/><path d="M4 4v3a13 13 0 0 1 13 13h3A16 16 0 0 0 4 4Z"/></svg>
    RSS feed</a></p>
</div></section>
<section class="sec-tight"><div class="shell narrow">
  ${VISIBLE.length
    ? `<div class="plist">${VISIBLE.map(postCard).join('')}</div>`
    : `<p class="lede">No posts yet — the first one is being written.</p>`}
</div></section>`;
  return layout({
    title: 'Blog — Indie Core Dev',
    desc: 'Game updates, behind-the-scenes notes and technical write-ups from Indie Core Dev, a one-person mobile game studio in France.',
    canonical: '/blog/', cur: 'blog', body,
    jsonld: [crumbLD([['Home','/'],['Blog','/blog/']])],
  });
}

/* The table of contents. Rendered from the same outline that put the ids on the
   headings, so a link here cannot point at a heading that is not there.

   It is a <details> because that is a disclosure widget the browser already
   makes accessible — a keyboard-operable, screen-reader-announced toggle for
   free. On a wide screen it becomes a sticky column and the toggle is hidden,
   which is why the tiny script below opens it: a closed <details> hides its
   content in the UA stylesheet, and overriding that with CSS is not reliable
   across browsers. The script runs during parse, before first paint, so the
   sidebar is never drawn closed and nothing shifts. */
function tocBlock(toc){
  if (toc.length < 3) return '';   // two headings is a list, not a map
  return `<details class="toc ptoc" id="toc">
    <summary><span>Contents</span></summary>
    <nav aria-label="Table of contents">
      <div class="toc-h" aria-hidden="true">Contents</div><ol>
      ${toc.map(h => `<li class="l${h.level}${h.key ? ' key' : ''}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}
    </ol></nav>
  </details>
  <script>if(matchMedia('(min-width:1240px)').matches){var t=document.getElementById('toc');if(t)t.open=true}</script>`;
}

function pagePost(p, i){
  const prev = VISIBLE[i + 1], next = VISIBLE[i - 1];
  const held = p.date > TODAY;
  const body = `
<article class="post"><div class="shell post-shell"><div class="postgrid">
  <div class="post-head">
  <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/blog/">Blog</a> <span>/</span> <span style="color:var(--text)">${esc(p.title)}</span></nav>
  ${held ? `<div class="ptags" style="margin-top:26px"><span class="tcode">Not published yet — this page goes live on ${humanDate(p.date)}</span></div>` : ''}
  <div class="pmeta" style="margin-top:26px"><time datetime="${p.date}">${humanDate(p.date)}</time><span>·</span><span>${p.minutes} min read</span>${
    p.updated ? `<span>·</span><span>Updated <time datetime="${p.updated}">${humanDate(p.updated)}</time></span>` : ''}</div>
  <h1>${esc(p.title)}</h1>
  ${p.description ? `<p class="lede" style="margin-top:20px">${esc(p.description)}</p>` : ''}
  ${p.tags.length ? `<div class="ptags" style="margin-top:22px">${p.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div>` : ''}
  ${p.code ? (() => {
    const isGist = /gist\.github\.com/.test(p.code);
    const handle = p.code.replace(/^https?:\/\/(www\.)?(gist\.)?github\.com\//, '');
    const label  = p.codeLabel || (isGist ? 'Code snippet on GitHub Gist' : 'Source on GitHub');
    const kind   = isGist ? 'Gist' : 'Repository';
    return `<a class="repocard" href="${esc(p.code)}" target="_blank" rel="noopener">
    <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
    <span><strong>${esc(label)}</strong><em>${esc(kind)} &middot; ${esc(handle)}</em></span>
    <svg aria-hidden="true" class="ext" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
  </a>`;
  })() : ''}
  <hr class="prule">
  </div>
  ${tocBlock(p.toc)}
  <div class="article">${p.html}</div>
  ${p.changes.length ? `<section class="chlog" aria-labelledby="chlog-h">
    <h2 id="chlog-h">Change history</h2>
    <ol>${p.changes.map(c =>
      `<li><time datetime="${c.date}">${humanDate(c.date)}</time><p>${esc(c.text)}</p></li>`).join('')}</ol>
  </section>` : ''}
  <div class="pnav">
    ${prev ? `<a href="/blog/${prev.slug}/"><span>← Previous</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}
    ${next ? `<a href="/blog/${next.slug}/" class="r"><span>Next →</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
  </div>
</div></div></article>
<section class="sec-tight"><div class="shell narrow">
  <div class="band">
    <h2 style="font-size:clamp(26px,3.4vw,38px)">More posts</h2>
    <p>New writing when there is something worth saying. By email or by RSS, whichever you prefer.</p>
    <div class="cta-row" style="justify-content:center">
      <a class="btn btn-primary" href="/subscribe/?from=blog-post">Get it by email</a>
      <a class="btn btn-ghost" href="/blog/feed.xml">Subscribe by RSS</a>
    </div>
  </div>
</div></section>`;
  return layout({
    title: `${p.title} — Indie Core Dev`,
    desc: p.description || `${p.title} — notes from Indie Core Dev.`,
    canonical: `/blog/${p.slug}/`, cur: 'blog', body,
    // Only ever true on a preview build. The page exists so it can be read
    // before it ships; it must not be indexed before it ships.
    noindex: held,
    jsonld: [{
      '@context':'https://schema.org','@type':'BlogPosting',
      headline: p.title, datePublished: p.date, dateModified: p.updated || p.date,
      description: p.description, url: SITE + `/blog/${p.slug}/`,
      keywords: p.tags.join(', ') || undefined,
      author: { '@type':'Person', name:'Othmane Ettaib' },
      publisher: { '@type':'Organization', name:'Indie Core Dev', url: SITE },
      mainEntityOfPage: { '@type':'WebPage', '@id': SITE + `/blog/${p.slug}/` },
    }, crumbLD([['Home','/'],['Blog','/blog/'],[p.title, `/blog/${p.slug}/`]])],
  });
}

/* ───────── page: ASO reports ───────── */

/* The winnable table. Every column is a fact somebody could act on, and none of
   them is a search-volume estimate — the whole point of the report is that
   volume is the half everyone already sells and the half that does not decide
   anything. `min-width` on the table plus the scrolling wrapper keeps seven
   columns readable on a phone without collapsing them into cards, which loses
   the comparison between rows that makes a table worth printing. */
/* The app holding a keyword, linked to its Play listing.

   Every row here is an assertion a reader cannot otherwise check — "this app is
   number one for this phrase" — and the series' whole claim is that it measures
   rather than estimates. A claim nobody can verify is worth exactly as much as
   the estimates it criticises, so the name is a link.

   `rel="noopener"` and nothing else, deliberately:
     - not `noreferrer`, which would strip the Referer header and hide that the
       visit came from here. The referral is the point.
     - not `nofollow`. These are editorial citations, not paid or user-submitted
       placements, and Google's own guidance reserves nofollow for those.

   `hl`/`gl` carry the report's own locale, so the reader opens the same store
   the measurement was taken in rather than their own. Without them a reader in
   Paris checks a US claim against a French listing and concludes the report is
   wrong.

   Falls back to plain text when the id is missing — a snapshot harvested before
   app_id was collected still renders. */
/* Rankgrip, or an explicit blank where one of the four factors was never
   observed.

   A missing factor coalesces to zero in scripts/rankgrip.mjs, which lands at
   the most-open end of the scale — so an uncrawled keyword would render as a
   green, confident "Open", the single most misleading thing this table could
   say. /aso/rankgrip/ promises the opposite in as many words: "marked
   unmeasured rather than scored as open — an absent number is not a good one".
   The harvest already records `rankgripMeasured`; nothing read it until now. */
function gripCell(r){
  if (r.rankgripMeasured === false)
    return `<span class="grip g-unmeasured">—<span class="sr-only">not measured</span></span>`;
  return `<span class="grip g-${r.rankgripBand}">${r.rankgrip}</span>`;
}

function leaderCell(r, d){
  if (!r.app_name) return '—';
  const name = esc(r.app_name);
  if (!r.app_id) return name;
  const href = `https://play.google.com/store/apps/details?id=${encodeURIComponent(r.app_id)}` +
    `&hl=${encodeURIComponent(d.language)}&gl=${encodeURIComponent(d.country.toUpperCase())}`;
  /* The arrow is a ::after on the link, and an inline-block after text is a
     break opportunity — so on a wrapping two-line app name it landed alone on
     the second line, reading as a bullet rather than as part of the link. Tying
     it to the last word with a nowrap span is the fix; `name` is already
     escaped, and entities contain no spaces, so splitting on one is safe. */
  const words = name.split(' ');
  const last  = words.pop();
  const head  = words.length ? `${words.join(' ')} ` : '';
  return `<a class="xlink" href="${href}" target="_blank" rel="noopener">${head}<span class="nb">${last}</span></a>`;
}

function keywordTable(rows, caption, d){
  return `<div class="kwrap"><table class="ktable">
  <caption>${esc(caption)}</caption>
  <thead><tr>
    <th scope="col">Keyword</th>
    <th scope="col" class="n"><a href="/aso/rankgrip/">Rankgrip</a></th>
    <th scope="col" class="n">Demand</th>
    <th scope="col" class="n">Top 10</th>
    <th scope="col" class="n">Titles</th>
    <th scope="col" class="n">Tenure</th>
    <th scope="col">Number one</th>
  </tr></thead>
  <tbody>${rows.map(r => `<tr>
    <td class="kw">${esc(r.keyword)}</td>
    <td class="n">${gripCell(r)}</td>
    <td class="n">${demandScore(r.demand_final)}</td>
    <td class="n">${r.big_dev_slots}/10</td>
    <td class="n">${r.title_matches}</td>
    <td class="n">${heldFor(r.oldest_leader_days)}</td>
    <td class="held">${leaderCell(r, d)}</td>
  </tr>`).join('')}</tbody>
  </table></div>`;
}

function wallTable(rows, d){
  return `<div class="kwrap"><table class="ktable">
  <caption>The demand in this category that is not available, and who is sitting on it.</caption>
  <thead><tr>
    <th scope="col">Keyword</th>
    <th scope="col" class="n"><a href="/aso/rankgrip/">Rankgrip</a></th>
    <th scope="col" class="n">Demand</th>
    <th scope="col" class="n">Top 10</th>
    <th scope="col">Number one</th>
    <th scope="col" class="n">Installs</th>
  </tr></thead>
  <tbody>${rows.map(r => `<tr>
    <td class="kw">${esc(r.keyword)}</td>
    <td class="n">${gripCell(r)}</td>
    <td class="n">${demandScore(r.demand_final)}</td>
    <td class="n">${r.big_dev_slots}/10</td>
    <td class="held">${leaderCell(r, d)}</td>
    <td class="n">${installs(r.app_installs)}</td>
  </tr>`).join('')}</tbody>
  </table></div>`;
}

function pageAsoIssue(issue){
  const d = issue.data;
  const held = issue.date > TODAY;
  const body = `
<article class="post"><div class="shell post-shell"><div class="postgrid">
  <div class="post-head">
  <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/aso/">ASO reports</a> <span>/</span> <span style="color:var(--text)">${esc(issue.title)}</span></nav>
  ${held ? `<div class="ptags" style="margin-top:26px"><span class="tcode">Not published yet — this page goes live on ${humanDate(issue.date)}</span></div>` : ''}
  <div class="pmeta" style="margin-top:26px"><time datetime="${issue.date}">${humanDate(issue.date)}</time><span>·</span><span>${esc(d.categoryLabel)}</span><span>·</span><span>${d.country.toUpperCase()} · ${d.language}</span></div>
  <h1>${esc(issue.title)}</h1>
  ${issue.description ? `<p class="lede" style="margin-top:20px">${esc(issue.description)}</p>` : ''}
  <div class="kstat">
    <span><strong>${d.winnable.length}</strong> terms open</span>
    <span><strong>${d.counts.keywords_in_category.toLocaleString('en-GB')}</strong> keywords in the category</span>
    <span>ranks observed <strong>${d.window.from}</strong> to <strong>${d.window.to}</strong></span>
  </div>
  <hr class="prule">
  </div>
  ${/* The three sections below are rendered by this function rather than
        written in the markdown, so they are absent from the outline the body
        produced. Appending them here keeps the contents list honest: a reader
        looking for "the wall" finds it, and no entry points at a heading that
        is not on the page. */''}
  ${tocBlock([...issue.toc,
    { level: 2, id: 'the-open-terms',        text: 'The open terms' },
    { level: 2, id: 'the-wall',              text: 'The wall' },
    { level: 2, id: 'how-this-was-measured', text: 'How this was measured' }])}
  <div class="article">
    ${issue.html}
    <h2 id="the-open-terms">The open terms</h2>
    <p>Ordered by demand, and every term below is one a Play Store search actually returns. This
    is app store optimization research measured against the live store rather than estimated:
    <strong>Top 10</strong> is how many of the ten results belong to a
    developer big enough that outranking them is not a listing problem; <strong>titles</strong>
    is how many put the phrase in their app name, which is the single hardest signal to beat.
    <strong>Demand</strong> ranks these terms against each other — it is not an estimate of
    searches per month, and no honest number on this page is.</p>
    <p>Each app name is a link, marked <span class="xlink" aria-hidden="true"><span class="nb"></span></span>, that opens
    that app's Google Play listing in a new tab — in the country and language this report measured,
    so every row can be checked against the store itself.</p>
    ${keywordTable(d.winnable, `${d.winnable.length} winnable keywords in ${d.categoryLabel.toLowerCase()}, ${MONTH_NAME(d.month)}.`, d)}

    <div class="kwall">
    <h2 id="the-wall">The wall</h2>
    <p>The other half, and the reason to trust the first: the highest demand in
    ${esc(d.categoryLabel.toLowerCase())} that is <em>not</em> worth chasing, with the app standing on it.
    No amount of listing work takes these.</p>
    ${wallTable(d.wall, d)}
    </div>

    <div class="kgate">
    <h2 id="how-this-was-measured">How this was measured</h2>
    <p><strong>Rankgrip</strong> scores how tightly a keyword is already held, 0–100, over four
    factors: big-developer slot share (40%), exact title matches (25%), leader maturity (20%) and
    leader tenure (15%). Under 30 is open, 30–69 is a fight worth having, 70 and up will not move.</p>
    <p>Terms are attributed to ${esc(d.categoryLabel.toLowerCase())} by the categories of the apps
    holding their top ten, then filtered to phrases Play's own autocomplete offers, built only from
    words at least ${d.gate.brandMinDf} different app names use. Rankings were measured daily between
    ${d.window.from} and ${d.window.to}. The gate proposed ${d.counts.winnable};
    ${d.counts.excluded ? `${d.counts.excluded} were struck off by hand and ` : ''}${d.winnable.length} are printed here.</p>
    <p><a href="/aso/rankgrip/">Rankgrip in full — the four factors, their weights, every filter a
    keyword passes, and why there is no search volume column</a>.</p>
    </div>
  </div>
  ${/* Same category, newest first — so the pair reads as a series rather than
        as whatever happened to publish next. Without this each issue had exactly
        one internal link pointing at it, from the index, and nothing else on the
        site connected two issues that are otherwise the same report a month
        apart. */''}
  ${(() => {
    const sibs = ASO_VISIBLE.filter(x => x.data.category === d.category);
    const at   = sibs.findIndex(x => x.slug === issue.slug);
    const prev = sibs[at + 1], next = sibs[at - 1];
    if (!prev && !next) return '';
    return `<div class="pnav">
      ${prev ? `<a href="/aso/${prev.slug}/"><span>← ${MONTH_NAME(prev.data.month)}</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}
      ${next ? `<a href="/aso/${next.slug}/" class="r"><span>${MONTH_NAME(next.data.month)} →</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
    </div>`;
  })()}
</div></div></article>
<section class="sec-tight"><div class="shell narrow">
  <div class="band">
    <h2 style="font-size:clamp(26px,3.4vw,38px)">Next month's report</h2>
    <p>A new category every month, measured the same way. By email when it lands.</p>
    <div class="cta-row" style="justify-content:center">
      <a class="btn btn-primary" href="/subscribe/?from=aso">Get it by email</a>
      <a class="btn btn-ghost" href="/aso/${d.categorySlug}/">Every ${esc(d.categoryLabel.toLowerCase())} report</a>
    </div>
  </div>
</div></section>`;
  return layout({
    title: `${issue.title} — Indie Core Dev`,
    desc: issue.description || `Winnable Google Play keywords in ${d.categoryLabel.toLowerCase()}, ${MONTH_NAME(d.month)}.`,
    canonical: `/aso/${issue.slug}/`, cur: 'aso', body,
    noindex: held,
    /* Article, not Dataset. Dataset validates here and would even be defensible
       — but its rich results live in Google Dataset Search rather than in web
       search, and Google's own guidance expects a `distribution` pointing at a
       downloadable file plus a `license`, neither of which this page has. What
       the page actually is, is an article about data. Claiming otherwise buys
       nothing and misdescribes it.

       dateModified is carried separately because a report does get corrected,
       and a page that goes on telling Google it is untouched after a fix is the
       same lie the sitemap's lastmod used to tell. */
    jsonld: [{
      '@context':'https://schema.org','@type':'Article',
      headline: issue.title,
      description: issue.description ||
        `Google Play keywords in ${d.categoryLabel.toLowerCase()} scored for winnability, ${MONTH_NAME(d.month)}.`,
      url: SITE + `/aso/${issue.slug}/`,
      datePublished: issue.date,
      /* The later of the two, never the snapshot date alone. Every scheduled
         issue is harvested before the day it comes out, so a bare generatedAt
         claims the page was modified before it was published — which is not a
         thing that can happen, and which verify.mjs rejects. It only becomes a
         real modification date once a re-harvest lands after publication. */
      dateModified: [issue.date, (d.generatedAt || '').slice(0, 10)].filter(Boolean).sort().at(-1),
      about: `App store optimisation for ${d.categoryLabel.toLowerCase()} on Google Play`,
      temporalCoverage: `${d.window.from}/${d.window.to}`,
      inLanguage: d.language,
      isAccessibleForFree: true,
      /* Every issue points back at the one definition, so the score and the
         reports that use it read as one body of work rather than as a column
         heading that recurs. */
      mentions: { '@type':'DefinedTerm', name:'Rankgrip', '@id': SITE + '/aso/rankgrip/#rankgrip' },
      author: { '@type':'Person', name:'Othmane Ettaib' },
      publisher: { '@type':'Organization', name:'Indie Core Dev', url: SITE },
      mainEntityOfPage: { '@type':'WebPage', '@id': SITE + `/aso/${issue.slug}/` },
    }, crumbLD([['Home','/'],['ASO reports','/aso/'],[issue.title, `/aso/${issue.slug}/`]])],
  });
}

function asoCard(i){
  const d = i.data;
  const pills = [
    i.date > TODAY ? `<span class="tcode">Publishes ${humanDate(i.date)}</span>` : '',
    `<span>${esc(d.categoryLabel)}</span>`,
    `<span>${d.country.toUpperCase()}</span>`,
    `<span class="tcode">${d.winnable.length} open terms</span>`,
  ].filter(Boolean);
  return `<a class="pcard rv" href="/aso/${i.slug}/">
    <div class="pmeta"><time datetime="${i.date}">${humanDate(i.date)}</time><span>·</span><span>${MONTH_NAME(d.month)} data</span></div>
    <h2>${esc(i.title)}</h2>
    ${i.description ? `<p>${esc(i.description)}</p>` : ''}
    <div class="ptags">${pills.join('')}</div>
    <span class="plink">Read the report<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg></span>
  </a>`;
}

/* The method page, and the archive that gathers one category's issues.

   Both exist for the same reason: an issue used to be reachable from exactly
   one place, the index, and the index grows into a single undifferentiated
   list. An archive per category is the page somebody searching for
   "aso keywords for puzzle games" should land on — it accumulates rather than
   scrolling away, and every issue in the series links up to it. */
function pageAsoRankgrip(){
  const m = ASO_RANKGRIP;
  const body = `
<article class="post"><div class="shell post-shell"><div class="postgrid">
  <div class="post-head">
  <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/aso/">ASO reports</a> <span>/</span> <span style="color:var(--text)">Rankgrip</span></nav>
  <h1 style="margin-top:26px">${esc(m.title)}</h1>
  ${m.description ? `<p class="lede" style="margin-top:20px">${esc(m.description)}</p>` : ''}
  <hr class="prule">
  </div>
  ${tocBlock(m.toc)}
  <div class="article">${m.html}</div>
</div></div></article>
<section class="sec-tight"><div class="shell narrow">
  <div class="band">
    <h2 style="font-size:clamp(26px,3.4vw,38px)">The reports themselves</h2>
    <p>One Play category a month, measured exactly as described above.</p>
    <div class="cta-row" style="justify-content:center">
      <a class="btn btn-primary" href="/aso/">Read the reports</a>
    </div>
  </div>
</div></section>`;
  return layout({
    title: `${m.title} — Indie Core Dev`,
    desc: m.description,
    canonical: '/aso/rankgrip/', cur: 'aso', body,
    /* DefinedTerm is what makes a named metric legible to a machine: it says
       this page IS the definition of a term, rather than an article that happens
       to mention one. That is the difference between a score people quote and a
       methodology paragraph nobody can point at. */
    jsonld: [{
      '@context':'https://schema.org','@type':'DefinedTerm',
      '@id': SITE + '/aso/rankgrip/#rankgrip',
      name: 'Rankgrip',
      alternateName: 'Rankgrip Score',
      description: 'A 0-100 score for how tightly a Google Play search keyword is already held ' +
        'by incumbent apps, weighted over big-developer slot share, exact title matches, ' +
        'leader maturity and leader tenure. Zero is an open field; one hundred cannot be moved ' +
        'by any listing rewrite.',
      url: SITE + '/aso/rankgrip/',
      inDefinedTermSet: {
        '@type':'DefinedTermSet',
        name: 'Indie Core Dev Google Play keyword metrics',
        url: SITE + '/aso/',
      },
      /* Named author with a page behind them, rather than a bare string. A
         metric people are asked to cite should say who stands behind it, and
         "who made this" is a question both a reader and a crawler ask. */
      creator: { '@type':'Person', name:'Othmane Ettaib', url: SITE + '/about/' },
      publisher: { '@type':'Organization', name:'Indie Core Dev', url: SITE },
      dateCreated: '2026-09',
      isPartOf: { '@type':'WebSite', name:'Indie Core Dev', url: SITE },
    }, crumbLD([['Home','/'],['ASO reports','/aso/'],['Rankgrip','/aso/rankgrip/']])],
  });
}

/* One entry per category that has at least one published issue. */
const ASO_CATEGORIES = [...new Map(ASO_VISIBLE.map(i =>
  [i.data.categorySlug, { slug: i.data.categorySlug, label: i.data.categoryLabel }])).values()]
  .sort((a, b) => a.label.localeCompare(b.label));

function pageAsoCategory(cat){
  const issues = ASO_VISIBLE.filter(i => i.data.categorySlug === cat.slug);
  const low = cat.label.toLowerCase();
  /* An archive whose every issue is still held exists only on a preview build,
     so a person can read the PR. It must not be indexable, for the same reason
     the held issue itself is not: a leaked preview URL would otherwise put a
     page into Google ahead of the content it lists — and this one would list
     unpublished issues by name. */
  const anyLive = ASO_LIVE.some(i => i.data.categorySlug === cat.slug);
  const body = `
<section class="hero" style="padding-bottom:32px"><div class="shell narrow">
  <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/aso/">ASO reports</a> <span>/</span> <span style="color:var(--text)">${esc(cat.label)}</span></nav>
  <h1 style="font-size:clamp(34px,5vw,58px);margin-top:26px">Google Play keywords for<br><span class="grad">${esc(low)}.</span></h1>
    <p class="lede">Every month, the search terms in ${esc(low)} that a small studio can still rank for —
  and the ones held so tightly that no listing rewrite would move them. App store optimization
  research measured against the live Play Store rather than estimated from search volume.
  <a href="/aso/rankgrip/">How Rankgrip works</a>.</p>
</div></section>
<section class="sec-tight"><div class="shell narrow">
  <div class="plist">${issues.map(asoCard).join('')}</div>
</div></section>`;
  return layout({
    title: `Google Play keywords for ${low} — Indie Core Dev`,
    desc: `Which Google Play search terms in ${low} a small studio can still rank for — who holds ` +
          `the top ten, and for how long. A new report every month.`,
    canonical: `/aso/${cat.slug}/`, cur: 'aso', body,
    noindex: !anyLive,
    jsonld: [crumbLD([['Home','/'],['ASO reports','/aso/'],[cat.label, `/aso/${cat.slug}/`]])],
  });
}

function pageAsoIndex(){
  const body = `
<section class="hero" style="padding-bottom:32px"><div class="shell narrow">
  <span class="eyebrow">ASO reports</span>
  <h1 style="font-size:clamp(38px,5.6vw,68px)">Which Play keywords<br><span class="grad">you can actually take.</span></h1>
  <p class="lede">Every ASO tool sells search volume. Volume is the half that does not decide anything —
  the highest-demand term in a category is usually held by a billion-install app that has been there for
  years. These reports measure the other half: who is standing on a keyword, how long they have been
  there, and whether a listing rewrite could move them. One Play category a month, measured against the
  live store rather than estimated by a model.</p>
  <div class="cta-row rv" style="margin-top:22px">
    <a class="btn btn-primary" href="/subscribe/?from=aso-index">Get each report by email</a>
    <a class="btn btn-ghost" href="/aso/rankgrip/">What Rankgrip measures</a>
  </div>
  ${ASO_CATEGORIES.length > 1 ? `<div class="ptags" style="margin-top:24px">${
    ASO_CATEGORIES.map(c => `<a class="tcat" href="/aso/${c.slug}/">${esc(c.label)}</a>`).join('')}</div>` : ''}
</div></section>
<section class="sec-tight"><div class="shell narrow">
  ${ASO_VISIBLE.length
    ? `<div class="plist">${ASO_VISIBLE.map(asoCard).join('')}</div>`
    : `<p class="lede">No reports yet — the first one is being measured.</p>`}
</div></section>
${/* The questions below are the ones people actually type. Checked against
     Google's autocomplete rather than guessed: "google play keyword research",
     "google play keyword search volume" and "play store ranking algorithm"
     all return suggestions, where "google play keywords for games" and "how to
     find keywords for google play" return nothing at all.

     They are plain h2s, not FAQPage schema. FAQ rich results were restricted to
     government and health sites in 2023, so the markup would buy nothing; the
     headings still answer the query. */''}
<section class="sec-tight"><div class="shell narrow"><div class="article">
  <h2 id="what-these-are">What these reports are</h2>
  <p>App store optimization research for Google Play, published in full instead of sold. Each
  issue takes one Play Store category and lists the search terms a small studio can still rank
  for, naming the app holding each one. Everything is measured against the live store — no
  estimated volumes, no third-party panel.</p>

  <h2 id="how-to-find-keywords">How do you find keywords for a Google Play listing?</h2>
  <p>In this order. Start from phrases the Play Store's own autocomplete offers, which proves a
  wording is real. Drop anything built from a word only one studio uses, or you are chasing a
  brand rather than a market. Then — and this is the step most keyword research skips — look at
  who currently holds the top ten for each survivor, how long they have been there, and whether
  any of them carries the phrase in its app name. A term with demand you cannot reach is worth
  nothing. That last step is what <a href="/aso/rankgrip/">Rankgrip</a> scores.</p>

  <h2 id="search-volume">Is there a Google Play keyword search volume tool?</h2>
  <p>Not an honest one. Google publishes no search volume for Play, so every figure sold as one
  is inferred from something else — web search data, autocomplete ordering, a panel of installs —
  and scaled by a constant somebody picked. These reports carry no volume column for that reason,
  and the <a href="/aso/rankgrip/#search-volume">full argument is on the Rankgrip page</a>.</p>

  <h2 id="ranking">What decides where an app ranks in the Play Store?</h2>
  <p>Nobody outside Google knows the ranking algorithm, and any page claiming otherwise is
  guessing. What is observable is who ends up in the top ten and what those apps have in common:
  install scale, how long they have held the slot, and whether the search phrase appears in the
  app title. Those three are what these reports measure, because they are the ones you can check
  rather than infer.</p>

  <h2 id="cadence">How often is this updated?</h2>
  <p>One Play category a month, covering the month just ended. Every issue keeps the numbers it
  shipped with, so a score quoted last year still reads the same today.</p>
</div></div></section>`;
  return layout({
    title: 'Google Play keyword research reports — Indie Core Dev',
    desc: 'Which Google Play search terms a small studio can actually rank for — who holds the ' +
          'top ten and for how long, measured from daily ranks. One category a month.',
    canonical: '/aso/', cur: 'aso', body,
    jsonld: [crumbLD([['Home','/'],['ASO reports','/aso/']])],
  });
}

/* ───────── page: legal notice / mentions légales ───────── */
/* Required of any French site by LCEN art. 6 III. The identity details are the
   same ones published on /about/ and /contact/ — kept in one constant so the
   three pages cannot drift apart. */
const LEGAL_SECTIONS = [
  ['Site publisher', `
    <p>This website is published by:</p>
    <dl class="meta meta-2" style="margin:18px 0">
      <div><dt>Legal name</dt><dd>${esc(LEGAL.name)}</dd></div>
      <div><dt>Trading as</dt><dd>${esc(LEGAL.trading)}</dd></div>
      <div><dt>Legal form</dt><dd>${esc(LEGAL.form)}</dd></div>
      <div><dt>Registered address</dt><dd>${esc(LEGAL.address)}</dd></div>
      <div><dt>SIREN</dt><dd>${esc(LEGAL.siren)}</dd></div>
      <div><dt>APE code</dt><dd>${esc(LEGAL.ape)}</dd></div>
      <div><dt>Established</dt><dd>${esc(LEGAL.founded)}</dd></div>
      <div><dt>Email</dt><dd><a href="mailto:${EMAIL}">${EMAIL}</a></dd></div>
    </dl>
    <p>The business operates in France under self-employed status and is registered with the
    Répertoire National des Entreprises under the SIREN above.</p>`],

  ['Director of publication', `
    <p>${esc(LEGAL.name)}, in his capacity as owner of the business, is the director of
    publication (<i>directeur de la publication</i>) within the meaning of Article 6 III of
    the Law of 21 June 2004 for confidence in the digital economy (LCEN).</p>
    <p>Reach him at <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>`],

  ['Hosting', `
    <p>The site is hosted and delivered by:</p>
    <dl class="meta meta-2" style="margin:18px 0">
      <div><dt>Host</dt><dd>Cloudflare, Inc.</dd></div>
      <div><dt>Address</dt><dd>101 Townsend Street, San Francisco, CA 94107, United States</dd></div>
      <div><dt>Website</dt><dd><a href="https://www.cloudflare.com" target="_blank" rel="noopener">www.cloudflare.com</a></dd></div>
    </dl>
    <p>The pages are static files served from Cloudflare's network. What that means for your
    data is set out in the <a href="/privacy/">privacy policy</a>.</p>`],

  ['Intellectual property', `
    <p>The source code, text, layout, game artwork, screenshots, trailers, logos and names
    on this site are the property of ${esc(LEGAL.name)} — ${esc(LEGAL.trading)}, unless
    stated otherwise. They may not be reproduced or reused commercially without written
    permission.</p>
    <p>Two deliberate exceptions: code published from
    <a href="https://github.com/IndieCoreDev" target="_blank" rel="noopener">github.com/IndieCoreDev</a>
    is there to be copied and adapted, under the licence stated with it; and quoting a blog
    post with a link back is welcome and needs no permission.</p>
    <p>Google Play and the Google Play logo are trademarks of Google LLC.</p>`],

  ['Personal data', `
    <p>What this website processes, why, on what legal basis, and how to exercise your rights
    under the GDPR is set out in full in the <a href="/privacy/">privacy policy</a>. The short
    version: no cookies, no analytics, no accounts, and no banner because there is nothing to
    consent to.</p>
    <p>Each game has its own policy, listed at the end of that page.</p>`],

  ['Nothing is sold here', `
    <p>No goods or services are sold through this website. The games are distributed free of
    charge through Google Play, contain no in-app purchases, and any transaction relating to
    them is between you and Google under Google's own terms.</p>
    <p>There is therefore no online contract to conclude on this site, no right of withdrawal
    to exercise against it, and no consumer mediation scheme attached to it.</p>`],

  ['Applicable law', `
    <p>This notice, and use of this website, are governed by French law. In the absence of an
    amicable resolution, any dispute falls to the competent French courts.</p>
    <p>If something here is wrong, out of date, or a link is broken, the fastest fix is to
    email <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>`],
];

function pageLegal(){
  const body = `
<div class="shell doc">
  <nav class="toc" aria-label="On this page">
    <div class="toc-h">Contents</div>
    <ol>${LEGAL_SECTIONS.map(([head], i)=>{
      const n = String(i + 1);
      return `<li><a href="#s${n}"><i>${n.padStart(2,'0')}</i><span>${esc(head)}</span></a></li>`;
    }).join('')}</ol>
  </nav>
  <div>
    <div class="doc-head">
      <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <span style="color:var(--text)">Legal notice</span></nav>
      <span class="eyebrow">Mentions légales</span>
      <h1>Legal notice</h1>
      <div class="doc-meta">
        <span>Applies to: www.indiecore.net</span>
        <span>Updated: ${LEGAL.updated}</span>
        <span>Contact: <a href="mailto:${EMAIL}" style="color:var(--accent)">${EMAIL}</a></span>
      </div>
    </div>
    <div class="doc-body">
      ${LEGAL_SECTIONS.map(([head, html], i)=>{
        const n = String(i + 1);
        return `<section id="s${n}"><h2><i>${n.padStart(2,'0')}</i>${esc(head)}</h2>${html}</section>`;
      }).join('')}
    </div>
    <div class="cta-row" style="margin-top:48px">
      <a class="btn btn-ghost" href="/privacy/">Privacy policy</a>
      <a class="btn btn-ghost" href="/contact/">Contact</a>
    </div>
  </div>
</div>`;
  return layout({title:'Legal notice — Indie Core Dev',
    desc:'Mentions légales for www.indiecore.net: publisher, director of publication, SIREN, hosting provider, intellectual property and applicable law.',
    canonical:'/legal/', cur:'legal', body,
    jsonld:[crumbLD([['Home','/'],['Legal notice','/legal/']])]});
}

/* ───────── page: site privacy policy ───────── */
/* The website's own policy, distinct from the per-game ones. Kept at /privacy/
   because that URL is already in the nav and linked from the game pages; the
   five /privacy/<game>/ URLs are referenced from Play Console listings and are
   linked from the last section rather than moved. */
const SITE_PRIVACY_UPDATED = '28 August 2026';
const SITE_PRIVACY = [
  ['The short version', `
    <p>This website sets no cookies, runs no tracking script of any kind, and has no
    accounts, comments or forms. Nothing is stored on your device and no profile of you is
    built, so there is nothing to accept, decline or opt out of &mdash; which is why you were
    not shown a banner.</p>
    <p>Two things are unavoidable and worth being explicit about: the server that delivers
    these pages sees your IP address, and clicking a gameplay trailer loads a video from
    YouTube. Both are covered below.</p>
    <p>The games are a separate matter with their own policies. Those are linked at the
    bottom of this page.</p>`],

  ['Who is responsible', `
    <p>The data controller for this website, within the meaning of the General Data
    Protection Regulation (Regulation (EU) 2016/679, &ldquo;GDPR&rdquo; / RGPD), is:</p>
    <ul>
      <li>${LEGAL.name}, trading as ${LEGAL.trading} &mdash; a sole proprietorship
      (<i>entreprise individuelle</i>) established in France in April 2025</li>
      <li>SIREN ${LEGAL.siren} &mdash; APE 6201Z, computer programming</li>
      <li>Contact: <a href="mailto:${EMAIL}">${EMAIL}</a></li>
    </ul>
    <p>The studio is not required to appoint a Data Protection Officer, and has not
    appointed one. Write to the address above for anything on this page.</p>`],

  ['What happens when you visit', `
    <p>The site is static. There is no application server, no database and no user
    profile &mdash; every page was generated in advance and is served as a file.</p>
    <p>Delivery is handled by Cloudflare. Like any web server, it processes the request
    in order to answer it, which necessarily involves:</p>
    <ul>
      <li>your IP address</li>
      <li>the date and time of the request, and the page requested</li>
      <li>the browser and operating system your browser reports</li>
      <li>the referring page, if your browser sent one</li>
    </ul>
    <p><strong>Purpose:</strong> delivering the page you asked for, and protecting the
    site against attack and abuse. <strong>Legal basis:</strong> legitimate interest
    (Article 6(1)(f) GDPR) in operating a functioning, secure website.</p>
    <p>These records are held by Cloudflare acting as a processor, under its own
    retention schedule, and are not exported, enriched, joined to anything else or used
    to build a profile. No log is consulted to identify an individual visitor.</p>`],

  ['Cookies and tracking', `
    <p><strong>This site sets no cookies.</strong> It uses no session storage, no tracking
    pixels, no fingerprinting and no advertising tags. There is no Google Analytics, no
    Plausible, no Matomo &mdash; no analytics script of any kind runs in your browser, and
    no request leaves this domain unless you start a trailer (section 5).</p>
    <p><strong>Exactly one thing is written to your device</strong>, and only if you close
    the mailing-list invitation that can appear in the corner of a page after you have read
    most of it. Closing it stores a single entry in local storage, named
    <i>icd-ml-dismissed</i>, holding the value <i>1</i>. That is the whole of it. It is not
    an identifier, it is never sent anywhere, nothing else reads it, and clearing your
    browsing data removes it. Clicking through to the signup page stores the same entry,
    on the same reasoning: you have answered, so you should not be asked again.</p>
    <p>It exists to honour a refusal. Without it the invitation would return on the next
    page, and on every page after that. Storage that records your own choice needs no
    consent under Article 82 of the French Data Protection Act, which is why there is still
    no cookie banner here. You can check all of this in your browser's developer tools: that
    one entry is the only thing the storage panel will ever hold, and nothing at all is
    there until you close the invitation.</p>
    <p>Fonts are served from this domain rather than from a font CDN, so loading a page
    sends your IP address to no one but the host of this site.</p>
    <p><strong>Do I measure anything?</strong> Yes, in two ways, and neither involves you
    individually:</p>
    <ul>
      <li><strong>Aggregate traffic counts</strong> produced by the host from the server logs
      already described above &mdash; how many times a page was served, from which countries,
      from which referring sites. This is a summary of records that exist anyway; nothing
      extra is collected in order to produce it, and it cannot be resolved back to a person.</li>
      <li><strong>Search performance</strong> from Google Search Console: which search terms
      show this site in Google's results, and how often those results are clicked. That is
      Google reporting on its own search engine, aggregated and anonymised before it reaches
      me. It is not a measurement of you browsing here, and it happens whether or not you
      ever visit.</li>
    </ul>
    <p>Neither produces a profile, follows you between sites, or tells me who you are.</p>`],

  ['Gameplay trailers', `
    <p>Some game pages offer a trailer. The video is <em>not</em> loaded with the page.
    What you see before clicking is a still image served from this domain, and no request
    reaches Google until you press play.</p>
    <p>If you do press play, an embedded player is created on
    <code>youtube-nocookie.com</code>, YouTube's privacy-enhanced mode. At that point
    Google receives your IP address, information about your device, and the fact that you
    watched that video, and it becomes the controller for what it does with them.</p>
    <p><strong>Legal basis:</strong> consent (Article 6(1)(a) GDPR), given by the
    deliberate act of starting the video. Do not press play if you would rather Google
    were not involved; nothing else on the page depends on it. Google's handling is
    described in the
    <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google
    Privacy Policy</a>.</p>`],

  ['Links to other sites', `
    <p>Pages here link out to Google Play, to GitHub and occasionally elsewhere. Those
    are ordinary links: nothing is sent anywhere until you click one, and no tracking
    parameters are attached.</p>
    <p>Once you follow a link you are on someone else's site, under their privacy policy
    rather than this one.</p>`],

  ['If you email me', `
    <p>The contact page publishes an email address. There is no contact form, so nothing
    is collected unless you choose to write.</p>
    <p>If you do, your message and address are used to answer you and for nothing else.
    <strong>Legal basis:</strong> legitimate interest (Article 6(1)(f)) in replying to
    correspondence, or steps taken at your request before entering a contract
    (Article 6(1)(b)) where that applies. Messages are kept while the exchange is live
    and for as long as needed afterwards to make sense of any follow-up, then deleted.
    Writing to me does not add you to the mailing list. That is a separate opt-in you have
    to make deliberately, described below.</p>`],

  ['If you join the mailing list', `
    <p>The list is optional and this site works exactly the same without it. Joining asks
    for your email address &mdash; no name &mdash; and you choose at that point whether you
    want news about the games, the blog posts, or both.</p>
    <p>One more thing is recorded with it: which page you were on when you signed up, as a
    short label such as <i>mot-malin</i> or <i>blog</i>. It is part of the record showing
    where and how you consented, which Article 7(1) requires me to be able to produce. It
    is a single word chosen by the page itself &mdash; not the address you came from, not
    anything your browser reports, and nothing that follows you between visits or between
    sites. There is still no cookie and no tracking script anywhere on this website.</p>
    <p>Nothing is sent until you click a confirmation link in an email. If you never click
    it, the pending address is deleted after 30 days and you hear nothing at all.
    <strong>Legal basis:</strong> your consent (Article 6(1)(a)), given by that confirmation
    click and recorded with the date it happened. You can withdraw it at any time with the
    unsubscribe link in the footer of every email &mdash; one click, no login and no
    questions, because leaving has to be as easy as joining. Withdrawing does not affect
    anything already sent.</p>
    <p>The list is used for those emails and nothing else. It is never sold, rented or
    shared, never used to build advertising audiences, and your address is not matched
    against anything inside the games.</p>
    <p>The emails themselves carry the measurement any mailing-list provider adds: a small
    invisible image that records a message was opened, and links that pass through Kit so
    clicks can be counted. That is how the inactivity rule below is applied, and it is the
    one place this site measures anything at all. It records that a message was opened, not
    what you did afterwards. It stops entirely when you unsubscribe, and blocking remote
    images in your email program prevents it &mdash; nothing in the email breaks if you
    do.</p>
    <p>Unsubscribing stops everything and leaves a record marked unsubscribed, so that you
    cannot be added back by mistake. Addresses that go three years without a single email
    being opened are removed. Write to <a href="mailto:${EMAIL}">${EMAIL}</a> and the
    unsubscribe record is erased too.</p>`],

  ['Where the data goes', `
    <p>Nothing is sold, rented or shared for advertising. There are no data brokers and
    no advertising partners involved in this website.</p>
    <p>Three providers necessarily process data as described above, and all three are based
    in the United States:</p>
    <ul>
      <li><strong>Cloudflare, Inc.</strong> &mdash; hosting and delivery of this site</li>
      <li><strong>Google Ireland Ltd / Google LLC</strong> &mdash; only if you start a
      trailer</li>
      <li><strong>${esc(KIT.processor)}</strong> (trading as Kit) &mdash; only if you join
      the mailing list; it stores the list and sends the emails. ${KIT.dpf}</li>
    </ul>
    <p>Transfers outside the European Economic Area rely on the European Commission's
    Standard Contractual Clauses and, where the provider is certified, the EU&ndash;US
    Data Privacy Framework.</p>`],

  ['Your rights', `
    <p>Under the GDPR you have the right to request access to your personal data, to have
    it corrected or erased, to have its processing restricted, to receive it in a portable
    form, and to object to processing carried out on the basis of legitimate interest
    (Articles 15 to 22).</p>
    <p>Exercise any of them by writing to
    <a href="mailto:${EMAIL}">${EMAIL}</a>. You will get an answer within one month.
    Be aware of a practical limit: this site keeps no identifier for you, so for ordinary
    browsing there is generally no record that could be located and connected to you. If
    you have emailed me, that correspondence can be found and deleted, and the same goes
    for your entry on the mailing list.</p>
    <p>If you believe your data has been mishandled you may lodge a complaint with the
    French supervisory authority (Article 77):</p>
    <ul>
      <li>Commission Nationale de l'Informatique et des Libert&eacute;s (CNIL),
      3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07, France &mdash;
      <a href="https://www.cnil.fr" target="_blank" rel="noopener">www.cnil.fr</a></li>
    </ul>`],

  ['Changes to this policy', `
    <p>If this changes, the date at the top of the page changes with it and the previous
    wording stays in the site's public Git history, so the date is the honest signal.
    If a change materially affects the mailing list, subscribers are told by email.</p>`],
];

function pagePrivacyIndex(){
  const sections = SITE_PRIVACY.map(([head], i) => ({ num: String(i + 1), head }));
  const last = String(SITE_PRIVACY.length + 1);
  const body = `
<div class="shell doc">
  <nav class="toc" aria-label="On this page">
    <div class="toc-h">Contents</div>
    <ol>${sections.map(s=>`<li><a href="#s${s.num}"><i>${String(s.num).padStart(2,'0')}</i><span>${esc(s.head)}</span></a></li>`).join('')
      }<li><a href="#s${last}"><i>${last.padStart(2,'0')}</i><span>Privacy policies for the games</span></a></li></ol>
  </nav>
  <div>
    <div class="doc-head">
      <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <span style="color:var(--text)">Privacy</span></nav>
      <span class="eyebrow">Privacy policy</span>
      <h1>This website</h1>
      <div class="doc-meta">
        <span>Applies to: www.indiecore.net</span>
        <span>Updated: ${SITE_PRIVACY_UPDATED}</span>
        <span>Contact: <a href="mailto:${EMAIL}" style="color:var(--accent)">${EMAIL}</a></span>
      </div>
    </div>
    <div class="doc-body">
      ${SITE_PRIVACY.map(([head, html], i)=>{
        const n = String(i + 1);
        return `<section id="s${n}"><h2><i>${n.padStart(2,'0')}</i>${esc(head)}</h2>${html}</section>`;
      }).join('')}
      <section id="s${last}">
        <h2><i>${last.padStart(2,'0')}</i>Privacy policies for the games</h2>
        <p>The games are software you install on a device, and each has its own policy
        describing what that game does. Those pages are permanent &mdash; they are
        referenced from Google Play store listings, so their addresses do not change.</p>
      </section>
      <div class="grid4 grid-2" style="margin-top:28px">
        ${ALL.map(g=>`<a class="mini" href="/privacy/${g.slug}/">
          ${g.icon?`<img src="/assets/games/${g.icon}" alt="${esc(g.name)} app icon" aria-hidden="true" width="60" height="60">`:'<div style="width:60px;height:60px;border-radius:16px;margin-bottom:16px;border:1px dashed rgba(255,255,255,.26)"></div>'}
          <h3 class="mini-h">${esc(g.name)}</h3><span>${esc(g.pkg)}</span></a>`).join('')}
      </div>
    </div>
  </div>
</div>`;
  return layout({title:'Privacy policy — Indie Core Dev',
    desc:'No cookies, no tracking scripts, no accounts. What this website processes, why, and how to exercise your rights under the GDPR. Links to every game privacy policy.',
    canonical:'/privacy/', cur:'privacy', body,
    jsonld:[crumbLD([['Home','/'],['Privacy','/privacy/']])]});
}

function pageAbout(){
  const body = `
<section class="hero" style="padding-bottom:40px"><div class="shell narrow">
  <span class="eyebrow rv">The studio</span>
  <h1 class="rv" style="font-size:clamp(38px,5.6vw,68px)">One person,<br><span class="grad">five games,</span><br>no publisher.</h1>
  <p class="lede rv" style="max-width:640px">Indie Core Dev is a sole proprietorship founded by Othmane Ettaib, specialising in the development, publishing and distribution of video games, applications and websites.</p>
  <p class="lede rv" style="max-width:640px">Established in April 2025, the business operates in France under self-employed status. The mission is to deliver accessible, creative and high-quality digital experiences, distributed through Google Play and the web.</p>
  <div class="cta-row rv"><a class="btn btn-primary" href="/#games">See the games</a><a class="btn btn-ghost" href="/contact/">Get in touch</a></div>
</div></section>
<section class="sec-tight"><div class="shell narrow">
  <dl class="meta meta-3 rv">
    <div><dt>Legal name</dt><dd>Othmane Ettaib</dd></div>
    <div><dt>Business name</dt><dd>Indie Core Dev</dd></div>
    <div><dt>SIREN</dt><dd>${esc(LEGAL.siren)}</dd></div>
    <div><dt>APE code</dt><dd>6201Z</dd></div>
    <div><dt>Activity</dt><dd>Computer programming</dd></div>
    <div><dt>Established</dt><dd>April 2025</dd></div>
  </dl>
</div></section>`;
  return layout({title:'About the studio — Indie Core Dev',
    desc:'Indie Core Dev is the one-person game studio of Othmane Ettaib, founded in France in April 2025, making free puzzle games for Android with no in-app purchases.',
    canonical:'/about/', cur:'about', body,
    jsonld:[crumbLD([['Home','/'],['About','/about/']])]});
}

function pageContact(){
  const body = `
<section class="hero" style="padding-bottom:40px"><div class="shell narrow">
  <span class="eyebrow rv">Contact</span>
  <h1 class="rv" style="font-size:clamp(38px,5.6vw,68px)">Say hello.</h1>
  <p class="lede rv">Questions, feedback, support or press — this reaches the studio directly. We usually respond within 48 hours.</p>
  <div class="cta-row rv"><a class="btn btn-primary" href="mailto:${EMAIL}">${EMAIL}</a></div>
</div></section>
<section class="sec-tight"><div class="shell narrow">
  <dl class="meta meta-2 rv">
    <div><dt>Email</dt><dd><a href="mailto:${EMAIL}" style="color:var(--accent)">${EMAIL}</a></dd></div>
    <div><dt>Response time</dt><dd>Within 48 hours</dd></div>
    <div><dt>Registered address</dt><dd>${esc(LEGAL.address)}</dd></div>
    <div><dt>Business</dt><dd>${esc(LEGAL.trading)} · SIREN ${esc(LEGAL.siren)}</dd></div>
  </dl>
</div></section>`;
  return layout({title:'Contact — Indie Core Dev',
    desc:'Questions, feedback, support or press for Indie Core Dev games — email contact@indiecore.net and we usually reply within 48 hours.',
    canonical:'/contact/', cur:'contact', body,
    jsonld:[crumbLD([['Home','/'],['Contact','/contact/']])]});
}

/* ───────── pages: mailing list ─────────
   Three pages because double opt-in has three moments: the form, the "check
   your email" wait, and the confirmed landing. Kit redirects into the last two
   — their URLs are configured in the form settings, so renaming them here
   silently strands subscribers on a 404. Change one, change both. */
function pageSubscribe(){
  const body = `
<section class="hero" style="padding-bottom:40px"><div class="shell narrow">
  <span class="eyebrow rv">Mailing list</span>
  <h1 class="rv" style="font-size:clamp(38px,5.6vw,68px)">Hear when<br><span class="grad">a game ships.</span></h1>
  <p class="lede rv">A handful of times a year, when there is a new game, a real update to one,
  or something worth reading about building them. Never more often than that.</p>
</div></section>

<section class="sec-tight"><div class="shell narrow">
  <form class="sub-form" action="${KIT.action}" method="post">
    <label class="sub-label" for="sub-email">Your email address</label>
    <input class="sub-input" id="sub-email" type="email" name="email_address"
           autocomplete="email" placeholder="you@example.com" required>

    <fieldset class="sub-choice">
      <legend>What do you want to hear about?</legend>
      <label><input type="radio" name="fields[interest]" value="Games" required>
        <span>New games and updates</span></label>
      <label><input type="radio" name="fields[interest]" value="Blog">
        <span>Blog posts</span></label>
      <label><input type="radio" name="fields[interest]" value="Both">
        <span>Both</span></label>
    </fieldset>

    <!-- Which page sent you here, as a plain slug. Defaults to the channel, so
         with JavaScript off this still records "web" rather than nothing — the
         value that matters once the games start collecting opt-ins too. app.js
         narrows it to the page. Never a URL, never the Referer header. -->
    <input type="hidden" id="sub-source" name="fields[source]" value="web">

    <button class="btn btn-primary" type="submit">Send me the confirmation link</button>
  </form>

  <ul class="sub-terms">
    <li>Your email address and which page you came from. No name, and nothing
        else about your visit.</li>
    <li>Nothing is sent until you click a link in a confirmation email. Never click it and
        the address is deleted within 30 days.</li>
    <li>Every email has a one-click unsubscribe. No login, no questions.</li>
    <li>Never sold, rented or shared. <a href="/privacy/#s8">What happens to your address</a>.</li>
  </ul>

  <p class="sub-by">The list is stored and sent by
    <a href="${KIT.badge}" target="_blank" rel="nofollow noopener">Kit</a>,
    on behalf of ${esc(LEGAL.trading)}.</p>
</div></section>`;
  return layout({title:'Mailing list — Indie Core Dev',
    desc:'Hear when a new Indie Core Dev game ships. A few emails a year, one-click unsubscribe, no tracking and no sharing.',
    canonical:'/subscribe/', cur:'subscribe', body,
    jsonld:[crumbLD([['Home','/'],['Mailing list','/subscribe/']])]});
}

function subNote({eyebrow, head, lede, extra}){
  return `
<section class="hero" style="padding-bottom:56px"><div class="shell narrow" style="text-align:center">
  <span class="eyebrow">${esc(eyebrow)}</span>
  <h1 style="font-size:clamp(34px,5vw,60px)">${head}</h1>
  <p class="lede" style="margin-left:auto;margin-right:auto">${lede}</p>
  ${extra || ''}
</div></section>`;
}

function pageSubscribeThanks(){
  return layout({title:'Check your email — Indie Core Dev',
    desc:'One more step: confirm your subscription from the link in the email just sent to you.',
    canonical:'/subscribe/thanks/', cur:'', body: subNote({
      eyebrow:'Almost there',
      head:'Check your email.',
      lede:`An email is on its way from <b>${EMAIL}</b> with a confirmation link. Nothing is sent
            to you until you click it, and if you never do, the address is deleted within 30 days.`,
      extra:`<p class="lede" style="margin-left:auto;margin-right:auto;font-size:15.5px">
             Not there after a few minutes? Check the spam folder — and if it landed there,
             drag it to the inbox before clicking, or write to
             <a href="mailto:${EMAIL}" style="color:var(--accent)">${EMAIL}</a>.</p>
             <div class="cta-row" style="justify-content:center"><a class="btn btn-ghost" href="/">Back to the games</a></div>`}),
    jsonld:[crumbLD([['Home','/'],['Mailing list','/subscribe/']])]});
}

function pageSubscribeConfirmed(){
  return layout({title:'You are on the list — Indie Core Dev',
    desc:'Your subscription to the Indie Core Dev mailing list is confirmed.',
    canonical:'/subscribe/confirmed/', cur:'', body: subNote({
      eyebrow:'Confirmed',
      head:'You&rsquo;re on the list.',
      lede:`That is the whole setup. The next email arrives when there is a game to announce
            or something worth reading — a handful of times a year, no more.`,
      extra:`<p class="lede" style="margin-left:auto;margin-right:auto;font-size:15.5px">
             Every email carries a one-click unsubscribe. You can also read
             <a href="/privacy/#s8" style="color:var(--accent)">what happens to your address</a>
             at any time.</p>
             <div class="cta-row" style="justify-content:center"><a class="btn btn-primary" href="/#games">Browse the games</a><a class="btn btn-ghost" href="/blog/">Read the blog</a></div>`}),
    jsonld:[crumbLD([['Home','/'],['Mailing list','/subscribe/']])]});
}

/* ───────── build ───────── */
fs.rmSync(OUT, {recursive:true, force:true});
fs.mkdirSync(OUT, {recursive:true});

write('index.html', pageHome());
for (const g of ALL) {
  write(`games/${g.slug}/index.html`, pageGame(g));
  write(`privacy/${g.slug}/index.html`, pagePrivacy(g));
}
write('privacy/index.html', pagePrivacyIndex());
write('legal/index.html', pageLegal());
write('blog/index.html', pageBlogIndex());
VISIBLE.forEach((p, i) => write(`blog/${p.slug}/index.html`, pagePost(p, i)));
write('aso/index.html', pageAsoIndex());
if (ASO_RANKGRIP) write('aso/rankgrip/index.html', pageAsoRankgrip());
ASO_CATEGORIES.forEach(c => write(`aso/${c.slug}/index.html`, pageAsoCategory(c)));
ASO_VISIBLE.forEach(i => write(`aso/${i.slug}/index.html`, pageAsoIssue(i)));
write('about/index.html', pageAbout());
write('contact/index.html', pageContact());
write('subscribe/index.html', pageSubscribe());
write('subscribe/thanks/index.html', pageSubscribeThanks());
write('subscribe/confirmed/index.html', pageSubscribeConfirmed());

/* assets */
fs.mkdirSync(path.join(OUT,'assets'), {recursive:true});
/* No stylesheet is emitted: cssFor() inlines the rules each page needs, so the
   copy at /assets/styles.css was 32 KB that no page ever linked to. */
fs.writeFileSync(path.join(OUT, 'assets', APP_FILE), APP_SRC);
fs.cpSync(path.join(ROOT,'public/assets/games'),  path.join(OUT,'assets/games'), {recursive:true});
fs.cpSync(path.join(ROOT,'public/assets/fonts'),  path.join(OUT,'assets/fonts'), {recursive:true});
if (fs.existsSync(path.join(ROOT,'public/assets/og')))
  fs.cpSync(path.join(ROOT,'public/assets/og'),   path.join(OUT,'assets/og'),   {recursive:true});

/* gist:image-pipeline */
/* ── WebP derivatives (served via <picture>, the JPEG stays as fallback) ──
   Two things here are not obvious from the call sites.

   Encoding is content-addressed: the key is the source bytes plus the exact
   encoder settings, so a rebuild re-encodes only what actually changed.
   Before this, every build — including one that touched nothing but prose —
   re-ran cwebp about ninety times and produced byte-identical output.

   The widths are the sizes the page actually displays, not round numbers.
   Icons are the case worth remembering: they shipped a single 256px square
   into a 56px slot, which Lighthouse scored as 18 KB of waste per icon on a
   page that renders five of them. */
const IMG_CACHE = path.join(ROOT, '.cache/images');
fs.mkdirSync(IMG_CACHE, { recursive: true });

// -icon and -feature are checked before the numbered-screenshot pattern:
// "word-slot-01" is a shot, but "logo-quiz-icon" must not be read as one.
const kindOf = f => /-icon\.jpg$/.test(f)    ? 'icon'
                  : /-feature\.jpg$/.test(f) ? 'feature'
                  : /-\d+\.jpg$/.test(f)     ? 'shot'
                  : 'other';

/* Widths are what the templates render at, doubled for retina. Quality is per
   width, and every value was derived rather than chosen: for each one, the
   lowest -m 6 -sharp_yuv setting whose PSNR still matches or beats what the
   old -m 4 encode produced, across every game's art, worst case wins. So this
   cannot look worse than what it replaces — the slower encoder simply reaches
   the same fidelity in fewer bytes, which is where an icon's 2.7 bits/px went.

   The full-size icon and key art are the exceptions and stay on the old
   encoder: at the quality they need, -m 6 came out marginally larger, so
   there was nothing to win. */
const M6 = true;
const VARIANTS = {
  // 56px on the home rows, 60px on the related-games cards, 88px on a game header.
  // Icons are exempt from the byte ceiling below: they are small, and the art is
  // lettering and gradients, which is where WebP shows its seams first. Holding
  // one to w*h/6 costs 2.8-3.8 dB and shows as blotchy type at 3x, to save about
  // 1.4 KB.
  icon:    { base: [80, !M6], cap: false, widths: [[112, 65, M6], [176, 70, M6]] },
  feature: { base: [80, !M6], cap: true,  widths: [[400, 55, M6], [640, 60, M6], [880, 65, M6]] },
  // 200/320 serve the hero phones, the carousel and the screenshot grid alike.
  // The ladder stops at 320 deliberately. A 254px slot on a 2x screen would
  // take 508, and offering 400 got it: 1.57x of sharpness nobody asked for, at
  // 243 KB across a home page against 165 KB here. 320 is still above 1x, and
  // the full-size sibling is still built — the lightbox opens that.
  shot:    { base: [55, M6],  cap: true,  widths: [[200, 60, M6], [320, 60, M6]] },
  other:   { base: [80, !M6], cap: false, widths: [] },
};

/* The byte ceiling Chrome's image-delivery insight actually measures against.
   It reports both a file's size and the bytes it considers wasted on
   compression, and target = size - waste comes out at exactly one sixth of a
   byte per pixel every time (a 256x256 icon: 65536/6 = 10923, and it reported
   18804 - 7881 = 10923). Anything under the ceiling is never flagged, which is
   why a file 615 bytes over it stays quiet — the insight ignores savings below
   4 KiB.

   This is a ceiling and never a goal. Most screenshots already sit far under
   it, and encoding them *to* it would make them bigger: word-slot-02 at 400w
   is 21 KB against a 47 KB ceiling. */
const ceiling = (d, w) => {
  if (!d) return 0;
  const h = w ? Math.round(d.h * w / d.w) : d.h;
  return Math.floor((w || d.w) * h / 6);
};
let webp = 0, cached = 0, saved = 0;

/* Returns false only when cwebp itself is unavailable, which HAS_WEBP has
   already established before any markup was generated. */
function encodeWebp(src, dst, q, w, m6, cap) {
  // The method flags and the ceiling are part of the key: without them a cache
  // written before this change would be replayed as though it had been encoded
  // with it.
  const size = w ? ['-resize', String(w), '0'] : [];
  const args = [...(m6 ? ['-m', '6', '-sharp_yuv'] : []), '-q', String(q), ...size, '-quiet'];
  const key = crypto.createHash('sha256')
    .update(fs.readFileSync(src))
    .update('cwebp ' + args.join(' ') + ' cap=' + (cap || 0))
    .digest('hex') + '.webp';
  const hit = path.join(IMG_CACHE, key);

  if (fs.existsSync(hit)) { fs.copyFileSync(hit, dst); cached++; return true; }

  try {
    execFileSync('cwebp', [...args, src, '-o', dst], { stdio: 'ignore' });
    // Only the files that overshoot get re-encoded to the ceiling, so nothing
    // is ever made bigger to hit a target. -size runs its own search for the
    // quality that lands there.
    if (cap && fs.statSync(dst).size > cap)
      execFileSync('cwebp', ['-size', String(cap), '-m', '6', '-sharp_yuv', '-pass', '8',
        ...size, '-quiet', src, '-o', dst], { stdio: 'ignore' });
  } catch { return false; }

  fs.copyFileSync(dst, hit); webp++;
  return true;
}

for (const f of fs.readdirSync(path.join(OUT, 'assets/games'))) {
  if (!f.endsWith('.jpg')) continue;
  const src  = path.join(OUT, 'assets/games', f);
  const base = src.replace(/\.jpg$/, '');
  const v    = VARIANTS[kindOf(f)];

  const dim = DIMS[f];
  if (!encodeWebp(src, `${base}.webp`, v.base[0], 0, v.base[1], v.cap && ceiling(dim, 0))) break;
  saved += fs.statSync(src).size - fs.statSync(`${base}.webp`).size;
  for (const [w, q, m6] of v.widths)
    encodeWebp(src, `${base}-${w}.webp`, q, w, m6, v.cap && ceiling(dim, w));
}
/* /gist:image-pipeline */

fs.writeFileSync(path.join(OUT,'favicon.svg'),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC53D"/><stop offset="1" stop-color="#FF2D8E"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#g)"/><path d="M17 32V16h5.6c4.6 0 7.4 3 7.4 8s-2.8 8-7.4 8H17Zm4.6-3.6h.9c2.3 0 3.7-1.6 3.7-4.4s-1.4-4.4-3.7-4.4h-.9v8.8Z" fill="#20100A"/></svg>`);

/* RSS — a real feed helps the blog get picked up and shared */
const rssItems = POSTS.map(p => `  <item>
    <title>${esc(p.title)}</title>
    <link>${SITE}/blog/${p.slug}/</link>
    <guid isPermaLink="true">${SITE}/blog/${p.slug}/</guid>
    <pubDate>${new Date(p.date + 'T09:00:00Z').toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
  </item>`).join('\n');
write('blog/feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Indie Core Dev — Blog</title>
  <link>${SITE}/blog/</link>
  <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
  <description>Notes from a one-person game studio in France.</description>
  <language>en</language>
${rssItems}
</channel>
</rss>
`);

/* 404 */
write('404.html', layout({
  title:'Page not found — Indie Core Dev',
  desc:'That page does not exist. Browse the games instead.',
  canonical:'/404.html', cur:'', body:`
<section class="hero"><div class="shell narrow" style="text-align:center">
  <span class="eyebrow">404</span>
  <h1 style="font-size:clamp(38px,6vw,72px)">This level doesn&rsquo;t exist.</h1>
  <p class="lede" style="margin-left:auto;margin-right:auto">The page you were looking for has moved or never existed. The games are all still here.</p>
  <div class="cta-row" style="justify-content:center"><a class="btn btn-primary" href="/#games">Browse the games</a><a class="btn btn-ghost" href="/">Home</a></div>
</div></section>`}));

/* legacy Blogger URLs → new routes (Cloudflare _redirects)
   The old blog (indie-core-dev.blogspot.com, blogId 6513805563288303374) had
   seven static pages and exactly one post — confirmed against its Blogger
   feeds before Blogger was disconnected. All eight are mapped here. */
const redirects = [
  ...ALL.map(g => `/p/${g.legacy}.html            /privacy/${g.slug}/   301`),
  `/p/about.html                                  /about/               301`,
  `/p/contact.html                                /contact/             301`,
  // the single blog post: "PerfectMatch: Numbers"
  `/2025/05/perfectmatch-numbers.html             /games/number-match-merge-puzzle/  301`,
  // Two games' artwork was named after an internal codename. The files are now
  // named for the game, because Google reads a file name to work out what an
  // image is. These keep the old URLs answering — Google Images may hold them,
  // and a 404 there loses the image rather than moving it.
  ...ALL.filter(g => g.asset).flatMap(g => [
    `/assets/games/${g.key}-icon.jpg                /assets/games/${g.asset}-icon.jpg      301`,
    `/assets/games/${g.key}-feature.jpg             /assets/games/${g.asset}-feature.jpg   301`,
    ...g.shots.map((s, i) =>
      `/assets/games/${g.key}-0${i + 1}.jpg           /assets/games/${s}   301`),
  ]),
  // Blogger's feed endpoints, for anything still subscribed
  `/feeds/posts/default                           /blog/feed.xml        301`,
  `/feeds/posts/default/*                         /blog/feed.xml        301`,
  `/atom.xml                                      /blog/feed.xml        301`,
  `/rss.xml                                       /blog/feed.xml        301`,
].join('\n') + '\n';
fs.writeFileSync(path.join(OUT,'_redirects'), redirects);

/* sitemap + robots */
const today = new Date().toISOString().slice(0,10);

/* <lastmod> is a claim Google can check, and this one used to say that all 23
   URLs changed on every deploy. The documented consequence of an unreliable
   lastmod is that Google stops trusting it, and there is evidence it did:
   /privacy/word-slot/ and /privacy/number-match-merge-puzzle/ both sit at
   "Discovered - currently not indexed", never once fetched.

   So give each URL the date its own content actually moved. Posts carry a date
   in frontmatter and games carry the Play listing's update date; everything
   else derives from a tracked file, so ask git when that file last changed.
   No git, or a shallow clone, falls back to the build date — exactly what this
   did for every URL before. */
const gitDate = f => {
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', f], { cwd: ROOT }).toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  } catch { return ''; }
};
const asIso = s => {                            // play-data ships "Aug 26, 2026"
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  // Read back the same calendar fields that were parsed. toISOString() would
  // convert local midnight to UTC and land a day earlier anywhere east of
  // Greenwich, so the date would differ between a laptop and CI — and a
  // lastmod that changes with the builder is the unreliable signal this whole
  // change exists to remove.
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/* An index page is as fresh as the freshest thing it lists. */
const newest = (...ds) => ds.filter(Boolean).sort().at(-1) || today;

/* lastmod is "when the content last changed", not "when it was published" —
   so a revised post advertises the revision. */
const postDate   = p => String(p.updated || p.date).slice(0, 10);
const gameDate   = g => asIso(g.updated) || gitDate('_source/play-data.json') || today;
const policyDate = g => gitDate(`_source/legacy/txt_${g.legacy}.txt`) || today;

const urls = [
  ['/', '1.0', newest(...ALL.map(gameDate), ...POSTS.map(postDate))],
  ...ALL.map(g=>[`/games/${g.slug}/`, '0.9', gameDate(g)]),
  ['/blog/','0.8', newest(...POSTS.map(postDate))],
  /* The reports are a second content stream, and a fresh one: an issue's
     lastmod is its own publication date, and the index is as fresh as the
     newest issue on it. */
  ...(ASO_LIVE.length ? [['/aso/','0.8', newest(...ASO_LIVE.map(i => i.date))]] : []),
  ...(ASO_RANKGRIP ? [['/aso/rankgrip/', '0.8', gitDate('content/aso/_rankgrip.md') || today]] : []),
  ...ASO_CATEGORIES
    .map(c => [c, ASO_LIVE.filter(i => i.data.categorySlug === c.slug)])
    /* Live issues only. ASO_CATEGORIES is built from ASO_VISIBLE so the
       archives render for review on a preview build; the sitemap is a claim
       about the real site and may only list what is actually published. */
    .filter(([, own]) => own.length)
    .map(([c, own]) => [`/aso/${c.slug}/`, '0.7', newest(...own.map(i => i.date))]),
  ...ASO_LIVE.map(i => [`/aso/${i.slug}/`, '0.7', i.date]),
  ...POSTS.map(p=>[`/blog/${p.slug}/`, '0.7', postDate(p)]),
  ['/about/','0.6', gitDate('_source/legacy/txt_about.txt') || today],
  // Generated by build.mjs rather than from a content file, same as /legal/.
  ['/subscribe/','0.6', gitDate('build.mjs') || today],
  ['/contact/','0.5', gitDate('_source/legacy/txt_contact.txt') || today],
  ['/privacy/','0.4', newest(...ALL.map(policyDate))],
  ['/legal/','0.3', gitDate('build.mjs') || today],
  ...ALL.map(g=>[`/privacy/${g.slug}/`, '0.3', policyDate(g)]),
];
fs.writeFileSync(path.join(OUT,'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  urls.map(([u,pr,mod])=>`  <url><loc>${SITE}${u}</loc><lastmod>${mod}</lastmod><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`);

/* long-lived caching for static assets */
// Rules must not overlap: every matching rule is applied and the values are
// concatenated, so a broad /assets/* alongside /assets/games/* produces a
// malformed Cache-Control with two max-age values.
//
// `immutable` is only honest where a changed file can be given a changed URL.
// app.<hash>.js carries the hash in its name; games and fonts keep their names
// so Google Images keeps its index, and carry ?v=<hash> instead — see
// versionAssets above. verify.mjs fails the build if one of these paths is
// ever emitted without a cache key, because that copy would be unreachable
// for a year.
fs.writeFileSync(path.join(OUT,'_headers'),
`/assets/games/*\n  Cache-Control: public, max-age=31536000, immutable\n
/assets/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n
/assets/og/*\n  Cache-Control: public, max-age=604800\n
/assets/app.*.js\n  Cache-Control: public, max-age=31536000, immutable\n
/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()\n  Cross-Origin-Opener-Policy: same-origin\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'inline-speculation-rules'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'self' ${KIT.origin} ${KIT.returnTo.join(' ')}; frame-ancestors 'none'; upgrade-insecure-requests\n`);
fs.writeFileSync(path.join(OUT,'version.json'),
  JSON.stringify({ ...BUILD, builtAt: new Date().toISOString() }, null, 2) + '\n');
// The two double opt-in landing pages are reached by redirect from Kit, not by
// search. They are thin by design and there is nothing there worth indexing.
fs.writeFileSync(path.join(OUT,'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /subscribe/thanks/\nDisallow: /subscribe/confirmed/\n\nSitemap: ${SITE}/sitemap.xml\n`);

/* IndexNow key file — the crawlers fetch this to confirm we own the host
   before accepting a URL submission. Must sit at the site root. */
fs.writeFileSync(path.join(OUT, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY + '\n');

/* app-ads.txt — IAB Tech Lab authorised sellers, crawled by AdMob from the
   developer website listed on the Play Store. Must stay at the site root. */
fs.writeFileSync(path.join(OUT,"app-ads.txt"),
  "google.com, pub-1528760351282017, DIRECT, f08c47fec0942fa0\n");

console.log(`v${BUILD.version} (${BUILD.sha}) — built ${urls.length} pages → dist/  (${webp} webp encoded, ${cached} from cache, ${(saved/1024/1024).toFixed(2)} MB saved)`);
console.log(`  blog: ${POSTS.length} post(s)${SCHEDULED.length ? ` · ${SCHEDULED.length} held` : ''}`);
if (ALL_ASO.length) console.log(`  aso: ${ASO_LIVE.length} report(s)${ASO_SCHEDULED.length ? ` · ${ASO_SCHEDULED.length} held` : ''}` +
  ` · ${ASO_LIVE.reduce((n, i) => n + i.data.winnable.length, 0)} keyword rows`);
for (const g of ALL) console.log(`  /games/${g.slug}/  ·  /privacy/${g.slug}/  (${g.shots.length} shots)`);
