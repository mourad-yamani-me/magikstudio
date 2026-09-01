#!/usr/bin/env node
/**
 * Build verification — fails the pipeline on anything that would ship broken.
 * Pure Node, no dependencies. Run after `npm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '..', 'dist');
const SITE = 'https://www.indiecore.net';

const errors = [];
const warnings = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const walk = d => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const allFiles = walk(DIST);
const pages = allFiles.filter(f => f.endsWith('.html'));
const rel = f => '/' + path.relative(DIST, f).split(path.sep).join('/');

/** does a site-absolute URL resolve to a real file? */
const resolves = url => {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return fs.existsSync(path.join(DIST, 'index.html'));
  const p = path.join(DIST, clean);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return true;
  return fs.existsSync(path.join(p, 'index.html'));
};

const attr = (html, re) => [...html.matchAll(re)].map(m => m[1]);

for (const file of pages) {
  const where = rel(file);
  const html = fs.readFileSync(file, 'utf8');

  // ---- head essentials ----
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc  = (html.match(/name="description" content="([^"]*)"/) || [])[1] || '';
  const canon = (html.match(/rel="canonical" href="([^"]*)"/) || [])[1] || '';
  const ogimg = (html.match(/property="og:image" content="([^"]*)"/) || [])[1] || '';

  if (!title) fail(where, 'missing <title>');
  else if (title.length > 65) warn(where, `title ${title.length} chars (>65 may truncate)`);
  if (!desc) fail(where, 'missing meta description');
  else if (desc.length > 165) warn(where, `description ${desc.length} chars (>165 may truncate)`);
  if (!canon.startsWith(SITE)) fail(where, `canonical not absolute: "${canon}"`);
  if (!ogimg) fail(where, 'missing og:image');
  else if (!resolves(ogimg.replace(SITE, ''))) fail(where, `og:image missing on disk: ${ogimg}`);

  // ---- structure ----
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) fail(where, `expected exactly 1 <h1>, found ${h1s}`);

  // ---- content hygiene ----
  if (/&amp;(amp|lt|gt|quot|#\d);/.test(html)) fail(where, 'double-escaped HTML entity');
  if (/\[email\s*protected\]/i.test(html))     fail(where, 'unresolved Blogger email placeholder');
  if (/post-body|Obtenir le lien|__wavt/.test(html)) fail(where, 'Blogger markup leaked into output');
  if (/\bTODO\b|\bLOREM\b|lorem ipsum/i.test(html))  fail(where, 'placeholder text left in page');

  // ---- links ----
  for (const href of attr(html, /href="(\/[^"#][^"]*)"/g)) {
    if (!resolves(href)) fail(where, `dead internal link → ${href}`);
  }
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel="[^"]*noopener/.test(m[0])) fail(where, 'target="_blank" without rel="noopener"');
  }

  // ---- images ----
  for (const src of attr(html, /<img[^>]*\ssrc="(\/[^"]+)"/g)) {
    if (!resolves(src)) fail(where, `missing image → ${src}`);
  }
  // the lightbox loads this one, and a typo here is invisible until a click
  for (const u of attr(html, /data-full="([^"]+)"/g))
    if (u.startsWith('/') && !resolves(u)) fail(where, `missing lightbox image → ${u}`);

  for (const set of attr(html, /srcset="([^"]+)"/g)) {
    for (const cand of set.split(',')) {
      const u = cand.trim().split(/\s+/)[0];
      if (u.startsWith('/') && !resolves(u)) fail(where, `missing srcset image → ${u}`);
    }
  }
  // Images, and the two ways an image ends up with no accessible name.
  //
  // A missing `alt` is the obvious one. `alt=""` is the one that got past this
  // check for months: it is *correct* for an image inside a link that already
  // names it — repeating the name announces it twice — and *wrong* everywhere
  // else, where it means the image is decorative when it is not. Ten game icons
  // shipped that way, and an SEO crawler reported them as missing alt text,
  // which is exactly what they were.
  //
  // So `alt=""` has to be judged against its context rather than accepted on
  // sight: allowed only when an ancestor <a> or <button> already carries a name.
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = m[0];
    // A bare boolean `hidden` — the lightbox's empty slot, which is filled from
    // the thumbnail on open. NOT `aria-hidden`, which this used to match by
    // accident and so skipped every carousel image without checking it.
    if (/\shidden(?=[\s>])/.test(tag)) continue;

    if (!/\balt=/.test(tag)) {
      fail(where, `<img> without alt: ${tag.slice(0, 70)}`);
    } else if (/\balt=""/.test(tag) && !namedByAncestor(html, m.index)) {
      fail(where, `<img alt=""> with nothing to name it: ${tag.slice(0, 70)}\n` +
                  `           give it alt text, or put it inside the link/button whose text names it`);
    }
    if (!/\bwidth=/.test(tag)) warn(where, `<img> without width/height (layout shift risk)`);
  }

  // Inline SVG is an image too, and a screen reader announces an unlabelled one
  // as a graphic with no name. Every icon on this site sits beside real text, so
  // the right answer is always aria-hidden; a meaningful one would need a
  // <title> or aria-label instead.
  for (const m of html.matchAll(/<svg\b[^>]*>/g)) {
    if (/aria-hidden|aria-label|role="img"/.test(m[0])) continue;
    const close = html.indexOf('</svg>', m.index);
    if (close > 0 && html.slice(m.index, close).includes('<title')) continue;
    fail(where, `<svg> with no accessible name and no aria-hidden: ${m[0].slice(0, 60)}\n` +
                `           decorative icons take aria-hidden="true"`);
  }
}

/** Does an <a>/<button> ancestor of the tag at `pos` already carry a name? */
function namedByAncestor(html, pos) {
  const before = html.slice(0, pos);
  for (const tag of ['a', 'button']) {
    const opens = [...before.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))];
    const closes = (before.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (opens.length <= closes) continue;                   // not inside one
    const open = opens[opens.length - 1];
    if (/aria-label=/.test(open[0])) return true;
    const end = html.indexOf(`</${tag}>`, pos);
    const inner = html.slice(open.index + open[0].length, end < 0 ? pos : end);
    // text, or a sibling image that does have alt text
    if (inner.replace(/<[^>]+>/g, '').trim()) return true;
    if (/<img\b[^>]*\balt="[^"]+"/.test(inner)) return true;
  }
  return false;
}

// ---- third-party embed consent ----
// The trailer is the only thing on this site that hands a visitor to a third
// party, so it is the only place consent is in play. The click-to-load facade
// is the mechanism; this checks the other half — that the visitor is told what
// pressing play sends, and to whom, before they press it.
for (const file of pages) {
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes('data-trailer')) continue;
  const where = rel(file);
  if (!/youtube-nocookie\.com/.test(html))
    fail(where, 'trailer without the embed host named in the notice');
  if (!/sends your IP/.test(html))
    fail(where, 'trailer without a notice saying what pressing play transmits');
  if (!/href="\/privacy\/"/.test(html))
    fail(where, 'trailer notice does not link the privacy policy');
}

// ---- redirects ----
const redirectsFile = path.join(DIST, '_redirects');
if (!fs.existsSync(redirectsFile)) fail('_redirects', 'missing');
else {
  for (const line of fs.readFileSync(redirectsFile, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [from, to, code] = line.trim().split(/\s+/);
    if (!resolves(to))    fail('_redirects', `${from} → ${to} (target does not exist)`);
    if (code !== '301')   warn('_redirects', `${from} uses ${code}, expected 301`);
  }
}

// ---- sitemap ----
const sitemapFile = path.join(DIST, 'sitemap.xml');
if (!fs.existsSync(sitemapFile)) fail('sitemap.xml', 'missing');
else {
  const sm = fs.readFileSync(sitemapFile, 'utf8');
  const locs = attr(sm, /<loc>([^<]+)<\/loc>/g);
  if (!locs.length) fail('sitemap.xml', 'no <loc> entries');
  for (const loc of locs) {
    if (!loc.startsWith(SITE)) fail('sitemap.xml', `non-canonical host: ${loc}`);
    if (!resolves(loc.replace(SITE, ''))) fail('sitemap.xml', `dead URL: ${loc}`);
  }
  const listed = new Set(locs.map(l => l.replace(SITE, '')));
  for (const p of pages) {
    const url = rel(p).replace(/index\.html$/, '');
    // 404 and the two double opt-in landing pages are reached by error or by
    // redirect from Kit, never by search. robots.txt disallows the latter two.
    if (url === '/404.html') continue;
    if (url === '/subscribe/thanks/' || url === '/subscribe/confirmed/') continue;
    if (!listed.has(url)) warn('sitemap.xml', `page not listed: ${url}`);
  }
}

// ---- legal pages ----
// /privacy/ is a legal document, not marketing copy. These are the parts the
// GDPR actually requires: an identified controller, a named legal basis, the
// data-subject rights, and the supervisory authority a complaint goes to.
// Losing any of them to an edit would be silent, so it fails the build.
{
  const p = path.join(DIST, 'privacy/index.html');
  if (!fs.existsSync(p)) fail('privacy', 'missing /privacy/index.html');
  else {
    const html = fs.readFileSync(p, 'utf8');
    const required = {
      'controller identity (SIREN)': /943\s*647\s*503/,
      'GDPR named':                  /GDPR|RGPD/,
      'a legal basis cited':         /Article 6\(1\)/,
      'data-subject rights':         /Articles 15 to 22|Article 15/,
      'supervisory authority':       /CNIL/,
      'contact address':             /mailto:/,
    };
    for (const [what, re] of Object.entries(required)) {
      if (!re.test(html)) fail('/privacy/', `legal page is missing ${what}`);
    }
  }
}

// ---- mailing list ----
// Collecting an address for game marketing is prospection commerciale: it needs
// consent given in advance, for a purpose stated where the address is typed.
// Until this branch the policy said twice that no mailing list existed, so the
// failure mode here is a real one — a form shipping while the policy still
// describes a site that does not collect email, or a purpose named on the form
// and nowhere in the document. Each rule below is one half of that pair.
{
  const sub = path.join(DIST, 'subscribe/index.html');
  const pri = path.join(DIST, 'privacy/index.html');
  const hasForm = fs.existsSync(sub);
  const policy  = fs.existsSync(pri) ? fs.readFileSync(pri, 'utf8') : '';

  if (hasForm) {
    const html = fs.readFileSync(sub, 'utf8');
    const required = {
      'a link to the privacy policy':      /href="\/privacy\//,
      'the double opt-in stated up front': /confirmation link|confirm/i,
      'how to leave':                      /unsubscribe/i,
      'the processor named':               /Kit/,
      'both purposes described':           /games[\s\S]{0,200}blog|blog[\s\S]{0,200}games/i,
    };
    for (const [what, re] of Object.entries(required))
      if (!re.test(html)) fail('/subscribe/', `signup page is missing ${what}`);

    // The consent must be an affirmative act, enforced without JavaScript.
    if (!/name="fields\[interest\]"[^>]*required|required[^>]*name="fields\[interest\]"/.test(html))
      fail('/subscribe/', 'interest choice is not a required field — consent must be an affirmative act');
    if (/<input[^>]+type="(radio|checkbox)"[^>]+checked/.test(html))
      fail('/subscribe/', 'a consent option is pre-selected — consent cannot be the default');

    // The source field is the one thing collected besides the address, so it
    // has to stay declared and stay harmless. A non-empty default keeps the
    // record true with JavaScript off; the page must also say it is collected,
    // because "no name, nothing else" stopped being true when it was added.
    const src = html.match(/<input[^>]*id="sub-source"[^>]*>/);
    if (!src) fail('/subscribe/', 'hidden source field is missing');
    else {
      const value = (src[0].match(/value="([^"]*)"/) || [])[1] || '';
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(value))
        fail('/subscribe/', `source field default "${value}" is not a plain slug — it posts as-is when JavaScript is off`);
    }
    if (!/which page you came from/i.test(html))
      fail('/subscribe/', 'source field is collected but the page does not say so');
    if (!/which page you were on/i.test(policy))
      fail('/privacy/', 'the signup form records a source but the policy does not disclose it');
    // Kit puts an open-tracking pixel and click-wrapped links in every send,
    // and the inactivity rule below is only enforceable because of them. The
    // policy shipped once describing that rule without disclosing what powers
    // it, so the two are checked together: keep the rule, keep the disclosure.
    if (/without a single email\s+being opened/.test(policy) && !/invisible image/.test(policy))
      fail('/privacy/', 'the policy applies an open-rate rule without disclosing the open tracking it depends on');
    // .rv starts at opacity:0 and only becomes visible when app.js adds .in.
    // unrevealHero() strips it from the first section only, so a form in any
    // later section would be invisible with JavaScript off. That happened.
    if (/<form[^>]*class="[^"]*\brv\b/.test(html))
      fail('/subscribe/', 'form carries .rv — it would be invisible with JavaScript off');
    // The site's own deferred app.js and the JSON-LD block are fine — neither
    // touches the form. Anything else is either a third-party embed or inline
    // logic the form would come to depend on.
    for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
      if (/type="application\/ld\+json"/.test(attrs)) continue;
      // Speculation rules are a declarative JSON block the browser reads to
      // prefetch links. Nothing executes and nothing touches the form.
      if (/type="speculationrules"/.test(attrs)) continue;
      const src = attrs.match(/src="([^"]+)"/);
      if (src && src[1].startsWith('/assets/')) continue;
      fail('/subscribe/', `signup page loads a script (${src ? src[1] : 'inline'}) — the form must work with JavaScript off`);
    }

    const wants = {
      'the mailing list section':   /join the mailing list/i,
      'consent as the legal basis': /Article 6\(1\)\(a\)/,
      'the right to withdraw':      /withdraw/i,
      'Kit named as a processor':   /Kit/,
    };
    for (const [what, re] of Object.entries(wants))
      if (!re.test(policy)) fail('/privacy/', `a signup form exists but the policy is missing ${what}`);
  }

  if (/there is no mailing list/i.test(policy))
    fail('/privacy/', 'policy still says no mailing list exists');

  // form-action follows redirects, and Kit answers the POST with a 302 to the
  // apex domain which then 301s to www. Listing only the POST target shipped
  // once and blocked every submission — silently, with a console message that
  // names the one URL the policy does allow. Assert the whole chain.
  if (hasForm) {
    const headers = path.join(DIST, '_headers');
    const csp = fs.existsSync(headers)
      ? (fs.readFileSync(headers, 'utf8').match(/form-action ([^;]+);/) || [])[1] || ''
      : '';
    if (!csp) fail('_headers', 'a signup form exists but no form-action directive was found');
    else for (const host of ['https://app.kit.com', 'https://indiecore.net', 'https://www.indiecore.net'])
      if (!csp.split(/\s+/).includes(host))
        fail('_headers', `form-action is missing ${host} — it is a hop in the signup redirect chain, and the browser blocks the whole submission`);
  }

  // Both double opt-in landing pages are configured as redirect targets inside
  // Kit. Renaming one here strands every new subscriber on a 404.
  if (hasForm) for (const u of ['subscribe/thanks', 'subscribe/confirmed'])
    if (!fs.existsSync(path.join(DIST, u, 'index.html')))
      fail('/subscribe/', `missing /${u}/ — Kit redirects there after signup and after confirming`);
}

// ---- the "no analytics" promise ----
// /privacy/ says no analytics script of any kind runs in your browser and that
// no request leaves this domain unless you start a trailer. Nothing in the
// build enforces that — the CSP does, at runtime, and it is doing real work:
// Cloudflare injects its Web Analytics beacon into production HTML at the edge
// and script-src is the only reason it never loads. Widen script-src or
// connect-src to any host and the policy silently becomes false.
//
// frame-src is deliberately not checked: the trailer's YouTube embed is the
// one exception the policy itself names.
{
  const headers = path.join(DIST, '_headers');
  const pri = path.join(DIST, 'privacy/index.html');
  if (fs.existsSync(headers) && fs.existsSync(pri)) {
    const policy = fs.readFileSync(pri, 'utf8');
    const csp = fs.readFileSync(headers, 'utf8');
    const claimsNoAnalytics = /no analytics script of any kind/i.test(policy);

    if (claimsNoAnalytics) for (const directive of ['script-src', 'connect-src']) {
      const found = csp.match(new RegExp(directive + ' ([^;]+);'));
      if (!found) { fail('_headers', `${directive} is missing, so nothing enforces the "no analytics" claim`); continue; }
      const hosts = found[1].trim().split(/\s+/).filter(t => /^https?:/.test(t) || t === '*');
      if (hosts.length)
        fail('_headers', `${directive} allows ${hosts.join(', ')} — /privacy/ promises no analytics script and no request off this domain, and that promise is only true while this stays same-origin`);
    }
  }
}

// ---- font fallback metrics ----
// Plus Jakarta Sans is font-display:swap, so every weight paints in a fallback
// first. 'Jakarta Fallback' carries size-adjust and ascent/descent overrides so
// that swap does not resize anything — without it the nav links changed width
// and shifted the row. Adding a weight to fonts.mjs without adding a matching
// fallback face would bring the shift back for that weight, silently.
{
  for (const f of pages.slice(0, 1)) {          // the font CSS is identical on every page
    const css = [...fs.readFileSync(f, 'utf8').matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(m => m[1]).join('');
    // FONT_CSS is minified to '@font-face { ... }' and FONT_FALLBACK emits
    // '@font-face{...}', so the optional space is not cosmetic here.
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)];
    const declared = new Set(faces
      .filter(m => /Plus Jakarta Sans/.test(m[1]))
      .map(m => (m[1].match(/font-weight:\s*(\d+)/) || [])[1]).filter(Boolean));
    const covered = new Set(faces
      .filter(m => /Jakarta Fallback/.test(m[1]))
      .map(m => (m[1].match(/font-weight:\s*(\d+)/) || [])[1]).filter(Boolean));

    if (!declared.size) fail('fonts', 'no Plus Jakarta Sans @font-face was found — the parser below is looking at the wrong thing');
    if (!covered.size) fail('fonts', "no 'Jakarta Fallback' faces were emitted — the swap will shift layout");
    for (const w of declared)
      if (!covered.has(w))
        fail('fonts', `Plus Jakarta Sans ${w} has no metric-matched fallback — its swap will shift layout`);
    if (!/--body:[^;}]*Jakarta Fallback/.test(css))
      fail('fonts', "'Jakarta Fallback' is declared but --body does not use it, so nothing falls back to it");
  }
}

// ---- link names ----
// Two links with the same accessible name that go to different places read as
// one repeated choice to anyone using a screen reader: five "Play free"
// buttons on the home page, one per game, announced identically. The fix in
// this repo is a .sr-only suffix, which "Learn more" already carries.
//
// Query strings are stripped before comparing, so /subscribe/?from=home and
// /subscribe/?from=invite count as one destination — same page, same purpose,
// and the ?from= only records which link was used.
{
  const strip = h => h.split(/[?#]/)[0];
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const names = new Map();
    for (const [, attrs, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attrs.match(/href="([^"]*)"/);
      if (!href || href[1].startsWith('mailto:')) continue;
      const label = attrs.match(/aria-label="([^"]*)"/);
      // .sr-only text is part of the accessible name, so tags come out and
      // their contents stay; an image inside contributes its alt text.
      const name = (label ? label[1]
        : inner.replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, ' $1 ').replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ').trim().toLowerCase();
      if (!name) continue;
      if (!names.has(name)) names.set(name, new Set());
      names.get(name).add(strip(href[1]));
    }
    for (const [name, hrefs] of names)
      if (hrefs.size > 1)
        fail(rel(f), `${hrefs.size} links are announced as "${name}" but go to different places (${[...hrefs].slice(0, 3).join(', ')}) — add a .sr-only suffix so each says which`);
  }
}

// ---- per-page CSS ----
// build.mjs inlines only the rules a page can actually match, which cut the
// privacy pages from 32 KB of CSS to 10 KB. A rule dropped by mistake is
// invisible in the build log and surfaces as a broken layout in production,
// so the result is re-derived here from the finished page rather than trusted.
//
// The invariant is exact, not approximate: a selector is kept whenever ANY
// class it names is used, so for a class the page does use, EVERY selector
// mentioning it must survive. Counting them catches a partial drop, which a
// "does the name still appear somewhere" check does not — .toc a.on kept the
// name alive after every other .toc rule had gone.
{
  const sheet = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // every selector that introduces a block, @media preludes excluded
  const selectors = css => {
    const parts = css.split(/([{}])/);
    const out = [];
    for (let i = 0; i < parts.length - 1; i++)
      if (parts[i + 1] === '{' && !parts[i].trim().startsWith('@'))
        out.push(...parts[i].split(','));
    return out;
  };
  // .toc must not match .toc-h
  const mentions = (sels, c) => {
    const re = new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
    return sels.filter(s => re.test(s)).length;
  };

  const sheetSels = selectors(sheet);
  const sheetKeyframes = new Set([...sheet.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));

  // app.js builds the lightbox and the trailer after load, so these class
  // names are in no page's HTML and the loop below would never ask for them.
  // They are what the class-name approach is least able to see.
  const app = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/app.js'), 'utf8');
  const runtime = [...new Set([
    ...[...app.matchAll(/classList\.(?:add|remove|toggle)\(\s*'([^']+)'/g)].map(m => m[1]),
    ...[...app.matchAll(/className\s*=\s*'([^']+)'/g)].flatMap(m => m[1].split(/\s+/)),
    ...[...app.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)),
  ])].filter(c => c && mentions(sheetSels, c));

  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const pageSels = selectors([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join(''));
    const used = new Set([...html.matchAll(/class="([^"]*)"/g)]
      .flatMap(m => m[1].split(/\s+/)).filter(Boolean));
    const loadsApp = /<script[^>]+src="\/assets\/app\./.test(html);

    for (const c of [...used, ...(loadsApp ? runtime : [])]) {
      const want = mentions(sheetSels, c);
      if (!want) continue;
      const got = mentions(pageSels, c);
      if (got < want)
        fail(rel(f), `.${c} is styled by ${want} selector(s) in src/styles.css but only ${got} survived this page's inlined CSS`);
    }

    // @keyframes are carried over by name, not by selector, so the loop above
    // cannot see them going missing — and an animation that silently stops
    // running looks like a design change rather than a bug.
    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('');
    const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
    // Only names the stylesheet actually defines are interesting; the rest of
    // an animation shorthand is timing functions and keywords.
    for (const [, word] of css.matchAll(/animation(?:-name)?:([^;}]+)/g))
      for (const name of word.split(/[\s,]+/))
        if (sheetKeyframes.has(name) && !defined.has(name))
          fail(rel(f), `CSS animates "${name}" but its @keyframes block was dropped from this page's inlined CSS`);
  }
}

// ---- browser storage ----
// The policy names every key this site writes and says the storage panel holds
// that one entry and nothing else. That claim is checkable by any visitor with
// devtools open, so it has to stay true: a second key added to app.js without a
// matching line in the policy turns a verifiable promise into a false one.
{
  // The bundle is content-hashed (app.<hash>.js), so it has to be found by
  // shape rather than by name. An existsSync() on a fixed name used to guard
  // this block, which meant renaming the file would have switched the whole
  // check off without a word — so a missing bundle is now an error, not a skip.
  const bundles = fs.existsSync(path.join(DIST, 'assets'))
    ? fs.readdirSync(path.join(DIST, 'assets')).filter(f => /^app\.[0-9a-f]+\.js$/.test(f))
    : [];
  if (bundles.length !== 1)
    fail('/assets/', `expected exactly one app.<hash>.js bundle, found ${bundles.length}`);

  const appJs = path.join(DIST, 'assets', bundles[0] || 'app.js');
  const pri   = path.join(DIST, 'privacy/index.html');
  if (fs.existsSync(appJs) && fs.existsSync(pri)) {
    const js     = fs.readFileSync(appJs, 'utf8');
    const policy = fs.readFileSync(pri, 'utf8');
    const keys = new Set([...js.matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\(\s*([A-Za-z_$][\w$]*|'[^']*')/g)]
      .map(m => m[1]));
    // Resolve `KEY`-style constants back to their literal before reporting.
    const resolved = [...keys].map(k => {
      if (k.startsWith("'")) return k.slice(1, -1);
      const lit = js.match(new RegExp(`\\b${k}\\s*=\\s*'([^']+)'`));
      return lit ? lit[1] : k;
    });
    for (const key of resolved) {
      if (!policy.includes(key))
        fail('/privacy/', `app.js stores "${key}" but the policy never names it — the "one entry only" claim is checkable and would be false`);
    }
    if (/sessionStorage\./.test(js) && /no session\s+storage/.test(policy))
      fail('/privacy/', 'app.js uses sessionStorage while the policy says it does not');
  }
}

// ---- legal notice (LCEN art. 6 III) ----
// A French site must publish who runs it and who hosts it. Same reasoning as
// the privacy check: losing one of these to an edit would be invisible.
{
  const p = path.join(DIST, 'legal/index.html');
  if (!fs.existsSync(p)) fail('legal', 'missing /legal/index.html');
  else {
    const html = fs.readFileSync(p, 'utf8');
    const required = {
      'publisher name':          /Othmane Ettaib/,
      'registered address':      /94000/,
      'SIREN':                   /943\s*647\s*503/,
      'director of publication': /director of publication/i,
      'host name and address':   /Cloudflare, Inc\.[\s\S]{0,400}San Francisco/,
      'contact address':         /mailto:/,
    };
    for (const [what, re] of Object.entries(required)) {
      if (!re.test(html)) fail('/legal/', `legal notice is missing ${what}`);
    }
  }
}

// ---- required files ----
for (const f of ['robots.txt', 'app-ads.txt', '_headers', '404.html', 'favicon.svg']) {
  if (!fs.existsSync(path.join(DIST, f))) fail('dist', `missing ${f}`);
}

// ---- IndexNow key file ----
// scripts/seo-ping.mjs submits URLs under this key; the crawlers reject the
// submission unless the matching file is live at the site root.
{
  const key = fs.readFileSync(path.join(import.meta.dirname, '..', '_source/indexnow-key.txt'), 'utf8').trim();
  const p = path.join(DIST, `${key}.txt`);
  if (!/^[a-f0-9]{8,128}$/.test(key)) fail('indexnow', `key is not 8-128 hex chars: "${key}"`);
  else if (!fs.existsSync(p)) fail('indexnow', `missing key file /${key}.txt`);
  else if (fs.readFileSync(p, 'utf8').trim() !== key) fail('indexnow', 'key file contents do not match the key');
}

// ---- app-ads.txt (IAB Tech Lab spec) ----
{
  const p = path.join(DIST, "app-ads.txt");
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/)
      .map(l => l.split("#")[0].trim()).filter(Boolean);
    if (!lines.length) fail("app-ads.txt", "no records");
    for (const line of lines) {
      if (/^[A-Z]+=/i.test(line)) continue;           // variable record, e.g. OWNERDOMAIN=
      const f = line.split(",").map(x => x.trim());
      if (f.length < 3 || f.length > 4)
        fail("app-ads.txt", `expected 3-4 fields: ${line}`);
      else if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(f[0]))
        fail("app-ads.txt", `field 1 is not an ad-system domain: ${line}`);
      else if (!/^(DIRECT|RESELLER)$/i.test(f[2]))
        fail("app-ads.txt", `field 3 must be DIRECT or RESELLER: ${line}`);
    }
  }
}

// ---- report ----
console.log(`checked ${pages.length} pages, ${allFiles.length} files\n`);
for (const w of warnings) console.log(`  warn   ${w}`);
if (warnings.length) console.log('');
for (const e of errors) console.log(`  ERROR  ${e}`);

if (errors.length) {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s) — failing build`);
  process.exit(1);
}
console.log(`passed — 0 errors, ${warnings.length} warning(s)`);
