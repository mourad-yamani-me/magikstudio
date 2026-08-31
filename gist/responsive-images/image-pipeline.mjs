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
