import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';

// pyftsubset: $PYFTSUBSET, then PATH. Without it the fonts still work, just larger.
function findSubsetter() {
  if (process.env.PYFTSUBSET) return process.env.PYFTSUBSET;
  try { execFileSync('pyftsubset', ['--help'], { stdio: 'ignore' }); return 'pyftsubset'; }
  catch { return null; }
}
const SUBSETTER = findSubsetter();
if (!SUBSETTER) console.warn('! pyftsubset not found — fonts will not be subset.\n'
  + '  pip install fonttools brotli   (or set PYFTSUBSET=/path/to/pyftsubset)');
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT  = path.join(ROOT, 'public/assets/fonts');
fs.mkdirSync(OUT, {recursive:true});

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const URL_ = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap';

const css = await (await fetch(URL_, {headers:{'User-Agent':UA}})).text();
const blocks = css.split('@font-face').slice(1).map(b => '@font-face' + b.slice(0, b.indexOf('}') + 1));

let out = '', n = 0;
for (const b of blocks) {
  const range = (b.match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
  // keep only the latin + latin-ext subsets; drop vietnamese/cyrillic/greek
  const isLatin = /U\+0000-00FF|U\+0100-02[Aa]F/.test(range);
  if (!isLatin) continue;
  const url = (b.match(/url\(([^)]+)\)/) || [])[1];
  const fam = (b.match(/font-family:\s*'([^']+)'/) || [])[1];
  const wgt = (b.match(/font-weight:\s*([^;]+);/) || [])[1].trim();
  if (!url) continue;
  const name = `${fam.toLowerCase().replace(/\s+/g,'-')}-${wgt.replace(/\s+/g,'-')}-${n++}.woff2`;
  const buf = Buffer.from(await (await fetch(url, {headers:{'User-Agent':UA}})).arrayBuffer());
  const full = path.join(OUT, name);
  fs.writeFileSync(full, buf);
  // subset to latin + latin-1 supplement + common punctuation
  try {
    if (!SUBSETTER) throw new Error('no subsetter');
    execFileSync(SUBSETTER, [full,
      /bricolage/.test(name)
        ? '--unicodes=U+0020-007E,U+00A0,U+00E9,U+2013,U+2014,U+2018-201D,U+2026,U+00B7'
        : '--unicodes=U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2000-206F,U+20AC,U+2122,U+2212',
      '--layout-features=kern,liga,calt', '--flavor=woff2', '--output-file=' + full + '.tmp']);
    const before = fs.statSync(full).size;
    fs.renameSync(full + '.tmp', full);
    console.log(`    subset: ${(before/1024).toFixed(0)} KB -> ${(fs.statSync(full).size/1024).toFixed(0)} KB`);
  } catch (e) { console.log('    (subset skipped)'); }
  out += b.replace(/url\([^)]+\)/, `url(/assets/fonts/${name})`).replace(/font-display:\s*swap/, 'font-display:optional') + '\n';
  console.log(`  ${name}  ${(buf.length/1024).toFixed(0)} KB  [${range.slice(0,28)}…]`);
}
fs.writeFileSync(path.join(OUT, 'fonts.css'), out);
console.log(`\n${n} woff2 files, fonts.css ${(out.length/1024).toFixed(1)} KB`);
