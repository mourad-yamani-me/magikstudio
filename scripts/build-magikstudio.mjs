import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { studio, games, legacyPolicies } from '../src/magikstudio/config.mjs';
import { layout, homePage, aboutPage, contactPage, gamePage, esc, validStore } from '../src/magikstudio/site.mjs';
import { legalPage } from '../src/magikstudio/legal.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
for (const game of games) {
  if (!/^[a-z0-9-]+$/.test(game.slug)) throw new Error('Invalid game slug');
  if (game.appStoreUrl && !validStore(game)) throw new Error('App Store links must use https://apps.apple.com/');
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const write = (name, content) => {
  const target = path.join(out, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
for (const folder of ['fonts','magikstudio']) {
  fs.cpSync(path.join(root,'public/assets',folder),path.join(out,'assets',folder),{recursive:true});
}
const fonts = fs.readFileSync(path.join(root,'public/assets/fonts/fonts.css'),'utf8').replaceAll('font-display:optional','font-display:swap');
write('assets/magikstudio/site.css', fonts + '\n' + fs.readFileSync(path.join(root,'src/magikstudio/styles.css'),'utf8') + '\n' + fs.readFileSync(path.join(root,'src/magikstudio/casual.css'),'utf8'));
write('assets/magikstudio/app.js', fs.readFileSync(path.join(root,'src/magikstudio/app.js')));
write('index.html',homePage());
write('about/index.html',aboutPage());
write('contact/index.html',contactPage());
for (const game of games) write(`games/${game.slug}/index.html`,gamePage(game));
for (const key of ['privacy','terms','legal']) write(`${key}/index.html`,legalPage(key));
// Preserve the reference site's published game-policy URLs and legal attribution.
// They are not used as Magikstudio game listings, nor included in its sitemap.
for (const [slug, legacy] of legacyPolicies) {
  let text = fs.readFileSync(path.join(root,`_source/legacy/txt_${legacy}.txt`),'utf8');
  text = text.replace(/^[\s\S]*?post-body[^>]*>/,'').split(/\n-\s*\n\nObtenir le lien/)[0].split(/window\['__wavt'\]/)[0];
  text = text.replace(/\n?Commentaires[\s\S]*$/,'').replace(/\n?©[\s\S]*$/,'');
  write(`privacy/${slug}/index.html`,layout({title:`Historical document: ${slug}`,description:'Historical privacy policy preserved from the reference repository with its original attribution.',route:`/privacy/${slug}/`,noindex:true,body:`<article class="shell doc"><div class="eyebrow">REFERENCE REPOSITORY DOCUMENT</div><h1>Historical privacy policy</h1><div class="legal-notice"><strong>Original publisher: Indie Core Dev</strong><p>Preserved at its historical address. This document does not describe the Magikstudio website or a Magikstudio game. Original attribution, language, and contact details are retained.</p></div><pre lang="fr">${esc(text)}</pre></article>`}));
}
// Keep reference newsletter routes resolvable without submitting to its account.
for (const route of ['subscribe','subscribe/thanks','subscribe/confirmed']) {
  write(`${route}/index.html`,layout({title:'Studio updates',description:'The Magikstudio newsletter is not available yet. Contact the studio with any questions.',route:`/${route}/`,noindex:true,body:'<section class="page-hero shell"><div class="eyebrow">MAGIKSTUDIO</div><h1>Let’s stay in touch.</h1><p class="page-lede">Newsletter signups are not open yet. This page does not register subscriptions.</p><a class="btn btn-primary" href="/contact/">Contact the studio</a></section>'}));
}
write('404.html',layout({title:'This page is still a daydream',description:'Page not found. Head back to explore Magikstudio and its games.',route:'/404.html',noindex:true,body:'<section class="page-hero shell"><div class="eyebrow">ERROR 404</div><h1>Oops. This level<br><span class="purple">doesn’t exist.</span></h1><p class="page-lede">The path ends here. Let’s head back to the playground.</p><a class="btn btn-primary" href="/">Back to home</a></section>'}));
write('favicon.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="#7045d6"/><path d="M8 29V11h5l7 9 7-9h5v18h-6V20l-6 8-6-8v9z" fill="#fff"/></svg>');
write('_redirects',legacyPolicies.map(([slug,legacy])=>`/p/${legacy}.html /privacy/${slug}/ 301`).concat(['/p/about.html /about/ 301','/p/contact.html /contact/ 301']).join('\n')+'\n');
write('_headers',`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
`);
const routes=['/','/about/','/contact/',...games.map(g=>`/games/${g.slug}/`)];
write('sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(route=>`<url><loc>${studio.url}${route}</loc></url>`).join('')}</urlset>`);
write('robots.txt',`User-agent: *\nAllow: /\nSitemap: ${studio.url}/sitemap.xml\n`);
write('version.json',JSON.stringify({name:studio.name,builtAt:new Date().toISOString()},null,2));
console.log(`Magikstudio built: ${routes.length} primary pages, 3 legal drafts, ${legacyPolicies.length} preserved policies.`);
