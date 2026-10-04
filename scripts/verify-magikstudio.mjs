import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { studio, games } from '../src/magikstudio/config.mjs';
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const pages=walk(dist).filter(p=>p.endsWith('.html'));
const exists=url=>{const p=path.join(dist,url.split(/[?#]/)[0]);return fs.existsSync(p)&&(fs.statSync(p).isFile()||fs.existsSync(path.join(p,'index.html')));};
for(const file of pages){
  const html=fs.readFileSync(file,'utf8');
  const label=path.relative(dist,file);
  assert.equal((html.match(/<h1[ >]/g)||[]).length,1,`${label}: one h1 required`);
  assert.match(html,/<html lang="en">/,`${label}: language`);
  assert.match(html,/<title>[^<]+<\/title>/,`${label}: title`);
  assert.match(html,/<meta name="description" content="[^"]+">/,`${label}: description`);
  assert.ok(html.includes(`rel="canonical" href="${studio.url}/`),`${label}: canonical`);
  for(const match of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g))assert.ok(exists(match[1]),`${label}: missing ${match[1]}`);
  for(const match of html.matchAll(/<img\b[^>]*>/g))assert.match(match[0],/alt="[^"]+"/,`${label}: image alt`);
  for(const match of html.matchAll(/<svg\b[^>]*>/g))assert.match(match[0],/aria-hidden="true"|aria-label=/,`${label}: SVG accessibility`);
  assert.ok(!/<form\b|app\.kit\.com/.test(html),`${label}: unexpected signup integration`);

}
for(const key of ['privacy','terms','legal']){
  const html=fs.readFileSync(path.join(dist,key,'index.html'),'utf8');
  assert.ok(html.includes('To be completed before publication'));
  assert.ok(html.includes('content="noindex"'));
}
const privacy=fs.readFileSync(path.join(dist,'privacy/index.html'),'utf8');
for(const term of ['data controller','Article 6','Articles 15–22','CNIL'])assert.ok(privacy.includes(term),`privacy: ${term}`);
for(const g of games){
  const html=fs.readFileSync(path.join(dist,'games',g.slug,'index.html'),'utf8');
  assert.equal(/class="store-link"/.test(html),Boolean(g.appStoreUrl),'App Store CTA must match configured URL');
}
console.log(`Verified ${pages.length} pages: links, assets, metadata, legal drafts and App Store state.`);
