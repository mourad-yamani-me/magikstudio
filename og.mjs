import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const G    = path.join(ROOT, 'public/assets/games');
const OUT  = path.join(ROOT, 'public/assets/og');
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found — set CHROME_PATH.'); process.exit(1); }
const MAGICK = process.env.MAGICK_PATH || 'magick';
const play = JSON.parse(fs.readFileSync(path.join(ROOT,'_source/play-data.json'),'utf8'));
fs.mkdirSync(OUT, {recursive:true});

const b64 = f => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(G,f)).toString('base64');
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const CHROME_CSS = `
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;background:#0B0616;color:#FFF6E9;
  font-family:'Bricolage Grotesque','Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif}
.bg{position:absolute;inset:0}
.bg i{position:absolute;border-radius:50%;filter:blur(90px)}
.i1{width:620px;height:620px;background:radial-gradient(circle,#FFC53D,transparent 65%);top:-230px;left:-160px;opacity:.55}
.i2{width:560px;height:560px;background:radial-gradient(circle,#FF2D8E,transparent 65%);bottom:-240px;right:-120px;opacity:.5}
.i3{width:420px;height:420px;background:radial-gradient(circle,#6B2BD9,transparent 65%);top:120px;left:45%;opacity:.45}
.wrap{position:relative;height:100%;display:flex;align-items:center;gap:52px;padding:0 72px}
.wrap.tight{padding-right:368px}
.wrap.tight .icon{width:158px;height:158px;border-radius:38px}
.icon{width:184px;height:184px;border-radius:44px;flex-shrink:0;box-shadow:0 26px 60px -14px rgba(0,0,0,.85)}
.txt{flex-grow:1;min-width:0}
.kick{font-size:20px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#FFC53D;margin-bottom:18px}
h1{font-size:62px;font-weight:800;letter-spacing:-.035em;line-height:1.03;overflow-wrap:break-word}
.wrap.tight h1{font-size:54px}
.sub{margin-top:18px;font-size:25px;line-height:1.4;color:#C6B6E0;font-family:'Plus Jakarta Sans',Arial,sans-serif}
.wrap.tight .pills span{padding:9px 17px;font-size:17px}
.pills{display:flex;gap:12px;margin-top:30px}
.pills span{padding:11px 20px;border-radius:100px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);
  font-size:19px;font-weight:700;color:#E8DCF5;font-family:'Plus Jakarta Sans',Arial,sans-serif}
.shot{position:absolute;right:-30px;bottom:-90px;width:290px;padding:8px;border-radius:42px;
  background:linear-gradient(160deg,#3A2358,#160C2A);transform:rotate(-7deg);
  box-shadow:0 40px 90px -18px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.1) inset}
.shot img{display:block;width:100%;border-radius:35px}
.brand{position:absolute;left:72px;bottom:40px;display:flex;align-items:center;gap:13px;
  font-size:22px;font-weight:800;letter-spacing:.02em}
.brand b{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;
  background:linear-gradient(135deg,#FFC53D,#FF2D8E);color:#20100A;font-size:22px}
.row{display:flex;gap:20px;margin-top:38px}
.row img{width:120px;height:120px;border-radius:30px;box-shadow:0 18px 44px -12px rgba(0,0,0,.85)}
`;

const page = inner => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@600;700&display=swap">
<style>${CHROME_CSS}</style></head><body>
<div class="bg"><i class="i1"></i><i class="i2"></i><i class="i3"></i></div>
${inner}
<div class="brand"><b>D</b> INDIE CORE DEV</div>
</body></html>`;

const gameCard = (name, tagline, icon, shot, offline = true) => page(`
<div class="wrap${shot ? ' tight' : ''}">
  ${icon ? `<img class="icon" src="${icon}">` : ''}
  <div class="txt">
    <div class="kick">Free on Google Play</div>
    <h1>${esc(name)}</h1>
    <div class="sub">${esc(tagline)}</div>
    <div class="pills"><span>No purchases</span><span>No sign-up</span>${offline ? '<span>Plays offline</span>' : ''}</div>
  </div>
</div>
${shot ? `<div class="shot"><img src="${shot}"></div>` : ''}`);

const heroCard = (kick, title, sub, icons) => page(`
<div class="wrap"><div class="txt">
  <div class="kick">${esc(kick)}</div>
  <h1 style="font-size:82px">${title}</h1>
  <div class="sub" style="max-width:760px">${esc(sub)}</div>
  <div class="row">${icons.map(i=>`<img src="${i}">`).join('')}</div>
</div></div>`);

/* targets */
const KEYS = { 'word-slot':'word-slot', 'soda-jam':'soda-jam', 'gridsmash':'gridsmash',
               'logo-quiz':'logo-quiz', 'perfectmatch':'perfectmatch' };
const targets = {};
for (const k of Object.keys(KEYS)) {
  const p = play[k];
  const shots = fs.readdirSync(G).filter(f => f.startsWith(k+'-') && /-\d+\.jpg$/.test(f)).sort();
  targets[k] = gameCard(p.title, p.short, b64(`${k}-icon.jpg`), shots.length ? b64(shots[0]) : null);
}

const allIcons = Object.keys(KEYS).map(k => b64(`${k}-icon.jpg`));
targets['home']    = heroCard('5 games · 100% free', 'FIVE PUZZLES.<br>ZERO PAYWALLS.',
  'Free puzzle games for Android with no in-app purchases, no sign-up, and offline play.', allIcons);
targets['default'] = heroCard('Indie Core Dev', 'FREE PUZZLE<br>GAMES.',
  'A one-person game studio in France. Five games on Google Play, all free, all playable offline.', allIcons);

/* render */
let n = 0;
for (const [name, html] of Object.entries(targets)) {
  const tmp = path.join('/tmp', `og-${name}.html`);
  fs.writeFileSync(tmp, html);
  const png = path.join('/tmp', `og-${name}.png`);
  execFileSync(CHROME, ['--headless=new','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1',
    '--virtual-time-budget=6000','--window-size=1200,630',`--screenshot=${png}`,'file://'+tmp], {stdio:'ignore'});
  execFileSync(MAGICK, [png, '-quality','86', path.join(OUT, `${name}.jpg`)], {stdio:'ignore'});
  n++;
}
console.log(`${n} OG images → public/assets/og/ (commit these)`);
for (const f of fs.readdirSync(OUT)) console.log(`  ${f}  ${(fs.statSync(path.join(OUT,f)).size/1024).toFixed(0)} KB`);
