import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
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
  fs.writeFileSync(f, rel.endsWith('.html') ? enhanceImages(unrevealHero(html)) : html);
};
const gridCols = n => Math.min(n, 6);
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

/* add intrinsic width/height (stops layout shift) and serve WebP with a JPEG fallback */
function enhanceImages(html){
  return html.replace(/<img ([^>]*?)src="\/assets\/games\/([^"]+\.jpg)"([^>]*?)>/g, (m, pre, file, post) => {
    const d = DIMS[file];
    const hasWH = /\bwidth=/.test(pre + post);
    const wh = (d && !hasWH) ? ` width="${d.w}" height="${d.h}"` : '';
    const img = `<img ${pre}src="/assets/games/${file}"${post}${wh}>`;
    const base = file.replace(/\.jpg$/,'');
    const isShot = /-\d+$/.test(base);
    const isHero = /\bdata-hero\b/.test(pre + post);
    const isFeature = /-feature$/.test(base);
    const srcset = isFeature
      ? `srcset="/assets/games/${base}-640.webp 640w, /assets/games/${base}.webp 1024w" sizes="(max-width:980px) 100vw, 1100px"`
      : isHero
      ? `srcset="/assets/games/${base}-200.webp 200w, /assets/games/${base}-320.webp 320w" sizes="(max-width:700px) 190px, 270px"`
      : isShot
      ? `srcset="/assets/games/${base}-200.webp 200w, /assets/games/${base}-320.webp 320w, /assets/games/${base}.webp ${d ? d.w : 506}w" sizes="(max-width:700px) 50vw, 280px"`
      : `srcset="/assets/games/${base}.webp"`;
    return `<picture><source type="image/webp" ${srcset}>${img}</picture>`;
  });
}

/* ───────── game data ───────── */
const GAMES = [
  { key:'word-slot',    slug:'word-slot',                 legacy:'privacy-policy-for-word-slot',
    blurb:'A crossword cut into blocks and scattered across the board. Slot every piece back until each row and column reads as a real word \u2014 and nothing on screen tells you when you are right. Working that out is the game.',
    feats:['392 hand-built stages','No timer, no fail state','Cloud save','Plays offline'] },
  { key:'soda-jam',     slug:'soda-jam-color-sort',       legacy:'privacy-policy-for-soda-jam-color-sort',
    blurb:'Pour, sort and clear the bottles until every colour finds its place. It starts gentle and turns genuinely mean — in the best way.',
    feats:['Hundreds of levels','No timer pressure','Undo & hints','Plays offline'] },
  { key:'gridsmash',    slug:'color-block-puzzle-master', legacy:'privacy-policy-for-gridsmash-block',
    video:'eOv0iC1BGfg',   // official gameplay trailer, the one listing that has one
    blurb:'Drop blocks, clear lines, chain the combo. One more go turns into an hour, and the grid never blinks first.',
    feats:['Combo scoring','Play Games leaderboards','Achievements','Plays offline'] },
  { key:'logo-quiz',    slug:'logo-quiz-guess-brand',     legacy:'privacy-policy-for-logo-quiz-guess-brand',
    blurb:'Reveal the logo, name the brand. You know more than you think you do — until suddenly you don’t.',
    feats:['Cloud save','Level packs','Hint system','Plays offline'] },
  { key:'perfectmatch', slug:'number-match-merge-puzzle', legacy:'privacy-policy-for-perfectmatch-numbers',
    blurb:'Match the pairs, merge the numbers, clear the board before it fills. The first game we shipped, and still the purest loop we’ve made.',
    feats:['Classic & endless','Quick sessions','No timer','Plays offline'] },
].map(g => {
  const p = play[g.key];
  return { ...p, ...g, name:p.title, tagline:p.short, playUrl:`https://play.google.com/store/apps/details?id=${p.pkg}`,
           shots:shotsFor(g.key), icon:`${g.key}-icon.jpg`,
           feature:`${g.key}-feature.jpg`, live:true };
});

const ALL = GAMES;

/* A game can need a published privacy policy before it has a page here: Play
   Console asks for the URL while the listing is still a draft, and the URL has
   to resolve the moment it is entered. These get /privacy/<slug>/ and nothing
   else — no store page, no icon, no screenshots. Move the entry into GAMES once
   the game is live and its assets exist. */
const PRIVACY_ONLY = [
  { key:'mot-malin', slug:'mot-malin', legacy:'privacy-policy-for-mot-malin',
    name:'Mot Malin', pkg:'com.motmalin.fillincrossword', policyOnly:true },
];
const ALL_PRIVACY = [...ALL, ...PRIVACY_ONLY];

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
const FONT_DISPLAY = FONT_FILES.find(f=>/bricolage.*-800-/.test(f)) || FONT_FILES[0];
const FONT_BODY    = FONT_FILES.find(f=>/jakarta.*-400-/.test(f))   || FONT_FILES[0];
const FONT_CSS = fs.readFileSync(path.join(ROOT,'public/assets/fonts/fonts.css'),'utf8')
  .replace(/(@font-face\s*\{[^}]*?Plus Jakarta Sans[^}]*?)font-display:\s*optional/g, '$1font-display:swap')
  .replace(/\s+/g,' ').trim();
const SITE_CSS = fs.readFileSync(path.join(ROOT,'src/styles.css'),'utf8')
  .replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s*([{}:;,>])\s*/g,'$1').replace(/;}/g,'}').replace(/\s+/g,' ').trim();

/* ───────── blog ───────── */
const BLOG_DIR = path.join(ROOT, 'content/blog');
const GIST_DIR = path.join(ROOT, 'gist');

/* Embeds a gist file inline, at the point in the article where it is being
   discussed. The content comes from gist/ — the same files the gist is
   published from — so the article, the gist and the live config cannot drift.
   GitHub's <script> embed is deliberately avoided: it is a render-blocking
   third-party request, unstyled, and would break the performance budget.

     {{gist:wrangler.jsonc}}          whole file
     {{gist:ci-cd.yml#head}}          everything above `jobs:`
     {{gist:ci-cd.yml#preview}}       one job, found by name
     {{gist:ci-cd.yml:64-92}}         explicit lines (fragile — prefer #anchors)

   Anchors are resolved from the YAML structure, so they survive edits above
   them; line numbers do not.
*/
const gistAnchor = name => 'file-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const LANG = { '.jsonc': 'json', '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml', '.md': 'markdown', '.mjs': 'javascript', '.js': 'javascript' };

/* gist/ holds one subdirectory per published gist. An embed may name the file
   alone — `verify.mjs` — and it is found wherever it lives, so posts don't
   have to know which gist a file ended up in. A `dir/file` path also works.
   Ambiguity is an error rather than a coin toss. */
function resolveGistFile(name, postFile) {
  const direct = path.join(GIST_DIR, name);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  const hits = fs.readdirSync(GIST_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(GIST_DIR, e.name, name))
    .filter(f => fs.existsSync(f));

  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const where = hits.map(h => path.relative(GIST_DIR, h)).join(', ');
    throw new Error(`${postFile}: {{gist:${name}}} — ambiguous, matches ${where}. Qualify it with the directory.`);
  }
  throw new Error(`${postFile}: {{gist:${name}}} — no such file under gist/`);
}

function embedGists(body, gistUrl, postFile) {
  return body.replace(/\{\{gist:([^:#}]+)(?:#([\w-]+))?(?::(\d+)-(\d+))?\}\}/g, (_, name, anchor, from, to) => {
    const file = resolveGistFile(name.trim(), postFile);
    const base = path.basename(name.trim());
    let content = fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
    let note = '';

    if (anchor) {
      const lines = content.split('\n');
      if (anchor === 'head') {
        const j = lines.findIndex(l => /^jobs:\s*$/.test(l));
        if (j < 0) throw new Error(`${postFile}: {{gist:${name}#head}} — no top-level "jobs:" key found`);
        content = lines.slice(0, j).join('\n').replace(/\s+$/, '');
        note = ' — triggers and permissions';
      } else {
        // find `  <anchor>:` and take everything until the next key at that indent
        const start = lines.findIndex(l => new RegExp(`^(\\s+)${anchor}:\\s*$`).test(l));
        if (start < 0) throw new Error(`${postFile}: {{gist:${name}#${anchor}}} — no "${anchor}:" key in ${path.relative(ROOT, file)}`);
        const indent = lines[start].match(/^\s*/)[0].length;
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i++) {
          const l = lines[i];
          if (l.trim() === '' || l.startsWith(' '.repeat(indent + 1))) continue;
          if (/^\s*#/.test(l)) continue;
          end = i; break;
        }
        content = lines.slice(start, end).join('\n').replace(/\s+$/, '');
        note = ` — ${anchor} job`;
      }
    } else if (from) {
      const lines = content.split('\n');
      if (+to > lines.length) throw new Error(`${postFile}: {{gist:${name}:${from}-${to}}} — file has only ${lines.length} lines`);
      content = lines.slice(+from - 1, +to).join('\n');
      note = ` lines ${from}–${to}`;
    }
    const lang = LANG[path.extname(base)] || '';
    const href = gistUrl ? `${gistUrl}#${gistAnchor(base)}` : '';
    // marked renders the fence; the surrounding markup is passed through as HTML
    return [
      `<figure class="gembed">`,
      `<figcaption><span class="gfile">${esc(base)}${note}</span>`,
      href ? `<a href="${href}" target="_blank" rel="noopener">Open in gist<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>` : '',
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
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    if (/^\[.*\]$/.test(v)) meta[k] = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
    else if (v === 'true' || v === 'false') meta[k] = v === 'true';
    else meta[k] = v.replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2] };
}

const POSTS = (fs.existsSync(BLOG_DIR) ? fs.readdirSync(BLOG_DIR) : [])
  // files starting with _ are scaffolding, not posts (templates, notes, README)
  .filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
  .map(f => {
    const { meta, body } = frontmatter(fs.readFileSync(path.join(BLOG_DIR, f), 'utf8'));
    const words = body.split(/\s+/).filter(Boolean).length;
    if (!meta.title) throw new Error(`content/blog/${f}: missing "title" in frontmatter`);
    if (!meta.date)  throw new Error(`content/blog/${f}: missing "date" in frontmatter`);
    return {
      slug: f.replace(/\.md$/, ''),
      title: meta.title,
      date: meta.date,
      description: meta.description || '',
      tags: meta.tags || [],
      draft: meta.draft === true,
      // `code:` takes a GitHub URL — a gist for a snippet, a repo for a project.
      // `repo:` is kept as an alias. The kind is detected from the URL.
      code: meta.code || meta.repo || meta.gist || '',
      codeLabel: meta.codeLabel || meta.repoLabel || '',
      minutes: Math.max(1, Math.round(words / 200)),
      html: marked.parse(embedGists(body, meta.code || '', f), { mangle: false, headerIds: false }),
    };
  })
  .filter(p => !p.draft)
  .sort((a, b) => b.date.localeCompare(a.date));

/* Every gist declares the post it links back to (scripts/build-gist.mjs). That
   post should carry a `code:` card pointing the other way, or the gist is
   published and nothing on the site sends anyone to it. A warning rather than
   an error, because there is a real window — between merging the post and the
   sync workflow creating the gist — where the URL does not exist yet. */
{
  const manifest = path.join(GIST_DIR, 'gists.json');
  if (fs.existsSync(manifest)) {
    for (const g of JSON.parse(fs.readFileSync(manifest, 'utf8'))) {
      const post = POSTS.find(p => p.slug === g.post);
      if (!post) continue;                       // draft or renamed; build-gist.mjs guards that
      if (!post.code) console.warn(
        `  warn  gist/${g.dir}/ links to /blog/${g.post}/, but that post has no \`code:\` field ` +
        `— add the gist URL so readers can find it.`);
    }
  }
}

const humanDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB',
  { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ───────── shared chrome ───────── */
const LOGO = (s=30) => `<svg width="${s}" height="${s}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC53D"/><stop offset="1" stop-color="#FF2D8E"/></linearGradient></defs>
<rect x="4" y="4" width="40" height="40" rx="12" fill="url(#lg)"/>
<path d="M17 32V16h5.6c4.6 0 7.4 3 7.4 8s-2.8 8-7.4 8H17Zm4.6-3.6h.9c2.3 0 3.7-1.6 3.7-4.4s-1.4-4.4-3.7-4.4h-.9v8.8Z" fill="#20100A"/></svg>`;
const PLAY_ICON = `<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.6 2.3 13.8 12 3.6 21.7c-.4-.2-.6-.6-.6-1.1V3.4c0-.5.2-.9.6-1.1Zm11.6 8.3L5.8 1.8l11.6 6.6-2.2 2.2Zm0 2.8 2.2 2.2-11.6 6.6 9.4-8.8Zm1.4-1.4 2.9-1.7c.7-.4.7-1.4 0-1.8l-2.9-1.7L14.2 12l2.4 2.4Z"/></svg>`;
const TICK = `<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

const NAV = cur => `
<header class="nav" id="nav"><div class="shell nav-in">
  <a href="/" class="brand">${LOGO(30)} Indie Core Dev</a>
  <nav class="nav-links">
    <a href="/#games"${cur==='games'?' aria-current="page"':''}>Games</a>
    <a href="/blog/"${cur==='blog'?' aria-current="page"':''}>Blog</a>
    <a href="/about/"${cur==='about'?' aria-current="page"':''}>About</a>
    <a href="/privacy/"${cur==='privacy'?' aria-current="page"':''}>Privacy</a>
    <a href="/contact/"${cur==='contact'?' aria-current="page"':''}>Contact</a>
    <a class="btn btn-primary btn-sm" href="/#games">Get the games</a>
  </nav>
  <button class="burger" aria-label="Menu" aria-expanded="false" aria-controls="mobmenu"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFF6E9" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
</div>
<div class="mobmenu" id="mobmenu">
  <a href="/#games">Games</a><a href="/blog/">Blog</a><a href="/about/">About</a><a href="/privacy/">Privacy</a><a href="/contact/">Contact</a><a href="/legal/">Legal</a>
</div></header>`;

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
      ${ALL_PRIVACY.map(g=>`<li><a href="/privacy/${g.slug}/">${esc(g.name)}</a></li>`).join('')}
    </ul></div>
    <div><h2 class="foot-h">Studio</h2><ul>
      <li><a href="/blog/">Blog</a></li>
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
<script src="/assets/app.js" defer></script>`;

function layout({title, desc, canonical, body, cur, jsonld, ogimg}){
  const og = SITE + (ogimg || '/assets/og/default.jpg');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}${canonical}">
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
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/${FONT_BODY}" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/${FONT_DISPLAY}" crossorigin>
<style>${FONT_CSS}</style>
<style>${SITE_CSS}</style>
${(Array.isArray(jsonld) ? jsonld : jsonld ? [jsonld] : []).map(b => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="aurora"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>
<div class="grain"></div>
${NAV(cur)}
<main id="main">
${body}
</main>
${FOOT}
</body>
</html>`;
}

const crumbLD = items => ({'@context':'https://schema.org','@type':'BreadcrumbList',
  itemListElement: items.map((it,i) => ({'@type':'ListItem', position:i+1, name:it[0], item:SITE+it[1]}))});

/* ───────── page: home ───────── */
function gameRow(g, i){
  const media = g.live && g.shots.length
    ? `<div><div class="gallery" data-gallery><div class="scr">
         ${g.shots.slice(0,4).map((s,n)=>`<img${n?'':' class="on"'} src="/assets/games/${s}" alt="${esc(g.name)} screenshot ${n+1}" loading="lazy">`).join('')}
       </div></div><div class="gdots"></div></div>`
    : `<div class="gallery"><div class="scr" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#241442,#140A26)">
         <svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.1" stroke-linecap="round" opacity=".8"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9h3M8 13h8M8 17h5"/></svg>
       </div></div>`;
  const cta = g.live
    ? `<img class="gicon" src="/assets/games/${g.icon}" alt="" width="56" height="56">
       <a class="btn btn-primary" href="${g.playUrl}" target="_blank" rel="noopener">${PLAY_ICON} Play free</a>
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
    <div class="phone p2" data-depth="26"><div class="scr"><img data-hero fetchpriority="low" src="/assets/games/gridsmash-02.jpg" alt="Color Block Puzzle Master gameplay" loading="lazy"></div></div>
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
      <div class="wico"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${ico}</svg></div>
      <h3>${h}</h3><p>${p}</p></div>`).join('')}
  </div>
</div></section>

<section class="sec" id="studio"><div class="shell">
  <div class="band rv">
    <h2>Made by one person.<br>Played all over the world.</h2>
    <p>Indie Core Dev is the studio of Othmane Ettaib, founded in France in April 2025. Every line of code, every level and every pixel is made here.</p>
    <div class="band-icons">
      ${GAMES.map(g=>`<a href="/games/${g.slug}/" title="${esc(g.name)}"><img src="/assets/games/${g.icon}" alt="${esc(g.name)}" width="74" height="74"></a>`).join('')}
    </div>
    <div class="cta-row" style="justify-content:center">
      <a class="btn btn-primary" href="/about/">About the studio</a>
      <a class="btn btn-ghost" href="/contact/">Get in touch</a>
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
  ];
  const body = `
<section class="ghero"><div class="shell ghero-grid">
  <div>
    <nav class="crumb rv"><a href="/">Home</a> <span>/</span> <a href="/#games">Games</a> <span>/</span> <span style="color:var(--text)">${esc(g.name)}</span></nav>
    <div class="ghead rv">
      ${g.icon?`<img src="/assets/games/${g.icon}" alt="" width="88" height="88">`:''}
      <div><span class="gtag">${esc(g.category)}${g.live?'':' · in development'}</span><h1 style="margin-top:12px">${esc(g.name)}</h1></div>
    </div>
    <p class="lede rv">${esc(g.tagline)}</p>
    <div class="cta-row rv">
      ${g.live
        ? `<a class="btn btn-primary" href="${g.playUrl}" target="_blank" rel="noopener">${PLAY_ICON} Get it on Google Play</a>`
        : `<span class="soon"><span class="dot"></span> Coming soon to Google Play</span>`}
      <a class="btn btn-ghost" href="/privacy/${g.slug}/">Privacy policy</a>
    </div>
    <div class="trust rv"><span>${TICK} Free to play</span><span>${TICK} No purchases</span>${g.offline===false?'':`<span>${TICK} Plays offline</span>`}</div>
    <dl class="meta rv">${metaRows.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  </div>
  <div class="game-media rv"><div class="halo"></div>
    ${g.shots.length ? `<div><div class="gallery" data-gallery><div class="scr">
      ${g.shots.map((s,n)=>`<img${n?'':' class="on"'} data-hero src="/assets/games/${s}" alt="${esc(g.name)} screenshot ${n+1}"${n?' loading="lazy"':''}>`).join('')}
    </div></div><div class="gdots"></div></div>`
    : `<div class="gallery"><div class="scr" style="display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#241442,#140A26)">
         <svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.1" stroke-linecap="round" opacity=".8"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9h3M8 13h8M8 17h5"/></svg></div></div>`}
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
      <span class="scr"><img src="/assets/games/${s}" alt="${esc(g.name)} screenshot ${n+1}" loading="lazy"></span>
      <span class="zoom"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8.5v5M8.5 11h5"/></svg></span>
    </button>`).join('')}
  </div>
</div></section>` : ''}

${g.video ? `<section class="sec-tight"><div class="shell">
  <div class="sec-head rv" style="margin-bottom:30px"><span class="eyebrow">Trailer</span><h2>See it in motion</h2></div>
  <button class="trailer rv" type="button" data-trailer="${g.video}" aria-label="Play the ${esc(g.name)} gameplay trailer">
    <img src="/assets/games/${g.feature}" alt="" loading="lazy" decoding="async">
    <span class="tplay"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg></span>
    <span class="tnote">Watch on YouTube &middot; nothing loads until you press play</span>
  </button>
  <p class="tconsent rv">Pressing play loads the video from <b>youtube-nocookie.com</b> and sends your IP
  address and device information to Google, who become responsible for it. Nothing else on this page
  depends on the video. <a href="/privacy/">What this site does with data</a></p>
</div></section>` : ''}

<section class="sec-tight"><div class="shell">
  <div class="sec-head rv" style="margin-bottom:32px"><span class="eyebrow">About this game</span><h2>What you&rsquo;re getting into</h2></div>
  <div class="prose rv">${renderDesc(g.desc)}</div>
  <ul class="feats rv" style="margin-top:26px">${g.feats.map(f=>`<li>${esc(f)}</li>`).join('')}</ul>
  ${g.live?`<div class="cta-row rv"><a class="btn btn-primary" href="${g.playUrl}" target="_blank" rel="noopener">${PLAY_ICON} Play ${esc(g.name)} free</a></div>`:''}
</div></section>

<section class="sec"><div class="shell">
  <div class="sec-head rv" style="margin-bottom:32px"><span class="eyebrow">More from the studio</span><h2>Other games</h2></div>
  <div class="grid4">
    ${others.map(o=>`<a class="mini rv" href="/games/${o.slug}/">
      ${o.icon?`<img src="/assets/games/${o.icon}" alt="" width="60" height="60">`:'<div style="width:60px;height:60px;border-radius:16px;margin-bottom:16px;border:1px dashed rgba(255,255,255,.26)"></div>'}
      <h3>${esc(o.name)}</h3><span>${esc(o.category)}${o.live?'':' · soon'}</span></a>`).join('')}
  </div>
</div></section>`;
  return layout({
    title:`${g.name} — free ${String(g.category).toLowerCase()} game for Android`,
    desc:`${g.tagline} Free on Google Play — no in-app purchases, no sign-up, plays offline.`,
    canonical:`/games/${g.slug}/`, cur:'games', body,
    ogimg:`/assets/og/${g.key}.jpg`,
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
  <aside class="toc">
    <div class="toc-h">Contents</div>
    <ol>${sections.map(s=>`<li><a href="#s${s.num}"><i>${String(s.num).padStart(2,'0')}</i><span>${esc(s.head)}</span></a></li>`).join('')}</ol>
  </aside>
  <div>
    <div class="doc-head">
      <nav class="crumb"><a href="/">Home</a> <span>/</span> <a href="/privacy/">Privacy</a> <span>/</span> <span style="color:var(--text)">${esc(g.name)}</span></nav>
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
  return `<a class="pcard rv" href="/blog/${p.slug}/">
    <div class="pmeta"><time datetime="${p.date}">${humanDate(p.date)}</time><span>·</span><span>${p.minutes} min read</span></div>
    <h2>${esc(p.title)}</h2>
    ${p.description ? `<p>${esc(p.description)}</p>` : ''}
    ${p.tags.length || p.code ? `<div class="ptags">${p.tags.map(t=>`<span>${esc(t)}</span>`).join('')}${p.code ? `<span class="tcode">${/gist\.github\.com/.test(p.code) ? 'gist' : 'code'}</span>` : ''}</div>` : ''}
    <span class="plink">Read<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg></span>
  </a>`;
}

function pageBlogIndex(){
  const body = `
<section class="hero" style="padding-bottom:32px"><div class="shell narrow">
  <span class="eyebrow">Blog</span>
  <h1 style="font-size:clamp(38px,5.6vw,68px)">Notes from<br><span class="grad">the studio.</span></h1>
  <p class="lede">Game updates, what goes on behind them, and the occasional technical write-up — from the person building them.</p>
  <p style="margin-top:18px"><a class="rsslink" href="/blog/feed.xml">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="6.2" cy="17.8" r="2.2"/><path d="M4 10.5v3a6.5 6.5 0 0 1 6.5 6.5h3A9.5 9.5 0 0 0 4 10.5Z"/><path d="M4 4v3a13 13 0 0 1 13 13h3A16 16 0 0 0 4 4Z"/></svg>
    RSS feed</a></p>
</div></section>
<section class="sec-tight"><div class="shell narrow">
  ${POSTS.length
    ? `<div class="plist">${POSTS.map(postCard).join('')}</div>`
    : `<p class="lede">No posts yet — the first one is being written.</p>`}
</div></section>`;
  return layout({
    title: 'Blog — Indie Core Dev',
    desc: 'Game updates, behind-the-scenes notes and technical write-ups from Indie Core Dev, a one-person mobile game studio in France.',
    canonical: '/blog/', cur: 'blog', body,
    jsonld: [crumbLD([['Home','/'],['Blog','/blog/']])],
  });
}

function pagePost(p, i){
  const prev = POSTS[i + 1], next = POSTS[i - 1];
  const body = `
<article class="post"><div class="shell narrow">
  <nav class="crumb"><a href="/">Home</a> <span>/</span> <a href="/blog/">Blog</a> <span>/</span> <span style="color:var(--text)">${esc(p.title)}</span></nav>
  <div class="pmeta" style="margin-top:26px"><time datetime="${p.date}">${humanDate(p.date)}</time><span>·</span><span>${p.minutes} min read</span></div>
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
    <svg class="ext" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>
  </a>`;
  })() : ''}
  <hr class="prule">
  <div class="article">${p.html}</div>
  <div class="pnav">
    ${prev ? `<a href="/blog/${prev.slug}/"><span>← Previous</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}
    ${next ? `<a href="/blog/${next.slug}/" class="r"><span>Next →</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
  </div>
</div></article>
<section class="sec-tight"><div class="shell narrow">
  <div class="band">
    <h2 style="font-size:clamp(26px,3.4vw,38px)">More posts</h2>
    <p>New writing when there is something worth saying. Subscribe by RSS, or get in touch.</p>
    <div class="cta-row" style="justify-content:center">
      <a class="btn btn-primary" href="/blog/feed.xml">Subscribe by RSS</a>
      <a class="btn btn-ghost" href="mailto:${EMAIL}">Email me</a>
    </div>
  </div>
</div></section>`;
  return layout({
    title: `${p.title} — Indie Core Dev`,
    desc: p.description || `${p.title} — notes from Indie Core Dev.`,
    canonical: `/blog/${p.slug}/`, cur: 'blog', body,
    jsonld: [{
      '@context':'https://schema.org','@type':'BlogPosting',
      headline: p.title, datePublished: p.date, dateModified: p.date,
      description: p.description, url: SITE + `/blog/${p.slug}/`,
      keywords: p.tags.join(', ') || undefined,
      author: { '@type':'Person', name:'Othmane Ettaib' },
      publisher: { '@type':'Organization', name:'Indie Core Dev', url: SITE },
      mainEntityOfPage: { '@type':'WebPage', '@id': SITE + `/blog/${p.slug}/` },
    }, crumbLD([['Home','/'],['Blog','/blog/'],[p.title, `/blog/${p.slug}/`]])],
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
  <aside class="toc">
    <div class="toc-h">Contents</div>
    <ol>${LEGAL_SECTIONS.map(([head], i)=>{
      const n = String(i + 1);
      return `<li><a href="#s${n}"><i>${n.padStart(2,'0')}</i><span>${esc(head)}</span></a></li>`;
    }).join('')}</ol>
  </aside>
  <div>
    <div class="doc-head">
      <nav class="crumb"><a href="/">Home</a> <span>/</span> <span style="color:var(--text)">Legal notice</span></nav>
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
    <p><strong>This site sets no cookies.</strong> It uses no local storage, no session
    storage, no tracking pixels, no fingerprinting and no advertising tags. There is no
    Google Analytics, no Plausible, no Matomo &mdash; no analytics script of any kind runs
    in your browser. You can verify this in your browser's developer tools: the storage
    panel stays empty, and no request leaves this domain unless you start a trailer
    (section 5).</p>
    <p>Fonts are served from this domain rather than from a font CDN, so loading a page
    sends your IP address to no one but the host of this site.</p>
    <p>Because nothing is read from or written to your device, no consent is required under
    Article 82 of the French Data Protection Act, and no cookie banner is shown.</p>
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
    They are never added to a mailing list &mdash; there is no mailing list.</p>`],

  ['Where the data goes', `
    <p>Nothing is sold, rented or shared for advertising. There are no data brokers and
    no advertising partners involved in this website.</p>
    <p>Two providers necessarily process data as described above, and both are based in
    the United States:</p>
    <ul>
      <li><strong>Cloudflare, Inc.</strong> &mdash; hosting and delivery of this site</li>
      <li><strong>Google Ireland Ltd / Google LLC</strong> &mdash; only if you start a
      trailer</li>
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
    you have emailed me, that correspondence can be found and deleted.</p>
    <p>If you believe your data has been mishandled you may lodge a complaint with the
    French supervisory authority (Article 77):</p>
    <ul>
      <li>Commission Nationale de l'Informatique et des Libert&eacute;s (CNIL),
      3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07, France &mdash;
      <a href="https://www.cnil.fr" target="_blank" rel="noopener">www.cnil.fr</a></li>
    </ul>`],

  ['Changes to this policy', `
    <p>If this changes, the date at the top of the page changes with it and the previous
    wording stays in the site's public Git history. There is no mailing list to notify,
    so the date is the honest signal.</p>`],
];

function pagePrivacyIndex(){
  const sections = SITE_PRIVACY.map(([head], i) => ({ num: String(i + 1), head }));
  const last = String(SITE_PRIVACY.length + 1);
  const body = `
<div class="shell doc">
  <aside class="toc">
    <div class="toc-h">Contents</div>
    <ol>${sections.map(s=>`<li><a href="#s${s.num}"><i>${String(s.num).padStart(2,'0')}</i><span>${esc(s.head)}</span></a></li>`).join('')
      }<li><a href="#s${last}"><i>${last.padStart(2,'0')}</i><span>Privacy policies for the games</span></a></li></ol>
  </aside>
  <div>
    <div class="doc-head">
      <nav class="crumb"><a href="/">Home</a> <span>/</span> <span style="color:var(--text)">Privacy</span></nav>
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
        ${ALL_PRIVACY.map(g=>`<a class="mini" href="/privacy/${g.slug}/">
          ${g.icon?`<img src="/assets/games/${g.icon}" alt="" width="60" height="60">`:'<div style="width:60px;height:60px;border-radius:16px;margin-bottom:16px;border:1px dashed rgba(255,255,255,.26)"></div>'}
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

/* ───────── build ───────── */
fs.rmSync(OUT, {recursive:true, force:true});
fs.mkdirSync(OUT, {recursive:true});

write('index.html', pageHome());
for (const g of ALL) {
  write(`games/${g.slug}/index.html`, pageGame(g));
}
for (const g of ALL_PRIVACY) {
  write(`privacy/${g.slug}/index.html`, pagePrivacy(g));
}
write('privacy/index.html', pagePrivacyIndex());
write('legal/index.html', pageLegal());
write('blog/index.html', pageBlogIndex());
POSTS.forEach((p, i) => write(`blog/${p.slug}/index.html`, pagePost(p, i)));
write('about/index.html', pageAbout());
write('contact/index.html', pageContact());

/* assets */
fs.mkdirSync(path.join(OUT,'assets'), {recursive:true});
fs.copyFileSync(path.join(ROOT,'src/styles.css'), path.join(OUT,'assets/styles.css'));
fs.copyFileSync(path.join(ROOT,'src/app.js'),     path.join(OUT,'assets/app.js'));
fs.cpSync(path.join(ROOT,'public/assets/games'),  path.join(OUT,'assets/games'), {recursive:true});
fs.cpSync(path.join(ROOT,'public/assets/fonts'),  path.join(OUT,'assets/fonts'), {recursive:true});
if (fs.existsSync(path.join(ROOT,'public/assets/og')))
  fs.cpSync(path.join(ROOT,'public/assets/og'),   path.join(OUT,'assets/og'),   {recursive:true});

/* WebP siblings (served via <picture>, JPEG stays as the fallback) */
let webp = 0, saved = 0;
for (const f of fs.readdirSync(path.join(OUT,'assets/games'))) {
  if (!f.endsWith('.jpg')) continue;
  const src = path.join(OUT,'assets/games',f);
  const dst = src.replace(/\.jpg$/, '.webp');
  try {
    execFileSync('cwebp', ['-q', /-\d+\.jpg$/.test(f) ? '60' : '80', '-quiet', src, '-o', dst], {stdio:'ignore'});
    webp++; saved += fs.statSync(src).size - fs.statSync(dst).size;
    if (/-feature\.jpg$/.test(f)) {
      execFileSync('cwebp', ['-q','72','-resize','640','0','-quiet', src, '-o',
        src.replace(/\.jpg$/,'-640.webp')], {stdio:'ignore'});
    }
    if (/-\d+\.jpg$/.test(f)) {
      for (const w of [200, 320]) {
        execFileSync('cwebp', ['-q','70','-resize',String(w),'0','-quiet', src, '-o',
          src.replace(/\.jpg$/,`-${w}.webp`)], {stdio:'ignore'});
      }
    }
  } catch (e) { /* cwebp unavailable — <picture> falls back to the JPEG */ }
}

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
  // Blogger's feed endpoints, for anything still subscribed
  `/feeds/posts/default                           /blog/feed.xml        301`,
  `/feeds/posts/default/*                         /blog/feed.xml        301`,
  `/atom.xml                                      /blog/feed.xml        301`,
  `/rss.xml                                       /blog/feed.xml        301`,
].join('\n') + '\n';
fs.writeFileSync(path.join(OUT,'_redirects'), redirects);

/* sitemap + robots */
const today = new Date().toISOString().slice(0,10);
const urls = [
  ['/', '1.0'], ...ALL.map(g=>[`/games/${g.slug}/`, '0.9']),
  ['/blog/','0.8'], ...POSTS.map(p=>[`/blog/${p.slug}/`, '0.7']),
  ['/about/','0.6'], ['/contact/','0.5'], ['/privacy/','0.4'], ['/legal/','0.3'],
  ...ALL_PRIVACY.map(g=>[`/privacy/${g.slug}/`, '0.3']),
];
fs.writeFileSync(path.join(OUT,'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
  urls.map(([u,pr])=>`  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`);

/* long-lived caching for fingerprint-free static assets */
// Rules must not overlap: every matching rule is applied and the values are
// concatenated, so a broad /assets/* alongside /assets/games/* produces a
// malformed Cache-Control with two max-age values.
fs.writeFileSync(path.join(OUT,'_headers'),
`/assets/games/*\n  Cache-Control: public, max-age=31536000, immutable\n
/assets/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n
/assets/og/*\n  Cache-Control: public, max-age=604800\n
/assets/styles.css\n  Cache-Control: public, max-age=86400\n
/assets/app.js\n  Cache-Control: public, max-age=86400\n
/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()\n  Cross-Origin-Opener-Policy: same-origin\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests\n`);
fs.writeFileSync(path.join(OUT,'version.json'),
  JSON.stringify({ ...BUILD, builtAt: new Date().toISOString() }, null, 2) + '\n');
fs.writeFileSync(path.join(OUT,'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

/* IndexNow key file — the crawlers fetch this to confirm we own the host
   before accepting a URL submission. Must sit at the site root. */
fs.writeFileSync(path.join(OUT, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY + '\n');

/* app-ads.txt — IAB Tech Lab authorised sellers, crawled by AdMob from the
   developer website listed on the Play Store. Must stay at the site root. */
fs.writeFileSync(path.join(OUT,"app-ads.txt"),
  "google.com, pub-1528760351282017, DIRECT, f08c47fec0942fa0\n");

console.log(`v${BUILD.version} (${BUILD.sha}) — built ${urls.length} pages → dist/  (${webp} webp, ${(saved/1024/1024).toFixed(2)} MB saved)`);
console.log(`  blog: ${POSTS.length} post(s)`);
for (const g of ALL) console.log(`  /games/${g.slug}/  ·  /privacy/${g.slug}/  (${g.shots.length} shots)`);
for (const g of PRIVACY_ONLY) console.log(`  /privacy/${g.slug}/  (policy only — no store page yet)`);
