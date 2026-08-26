#!/usr/bin/env node
/**
 * Generates the public gist's files from the real config, so the published
 * snippet can never drift from what this repo actually runs.
 * Output lands in gist/ and is committed, so changes are reviewable in a PR.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT  = path.join(ROOT, 'gist');
const SITE = 'https://www.indiecore.net';

/* The gist links back to the post that explains it. A post's URL is derived
   from its filename, so it is knowable before either exists — but that also
   means renaming the post would silently break the link. Resolve it from the
   file instead of hardcoding, and refuse to build if it is gone or a draft. */
const POST_SLUG = 'static-site-cloudflare-workers';

function backlink() {
  const file = path.join(ROOT, 'content/blog', `${POST_SLUG}.md`);
  if (!fs.existsSync(file)) {
    console.error(`refusing to build: the gist links to /blog/${POST_SLUG}/,`);
    console.error(`but content/blog/${POST_SLUG}.md does not exist.`);
    console.error('Rename POST_SLUG in this script, or restore the post.');
    process.exit(1);
  }
  if (/^draft:\s*true\s*$/m.test(fs.readFileSync(file, 'utf8'))) {
    console.error(`refusing to build: content/blog/${POST_SLUG}.md is a draft,`);
    console.error('so the gist would link to a page that is never published.');
    process.exit(1);
  }
  return `${SITE}/blog/${POST_SLUG}/`;
}
const POST_URL = backlink();

/** strip anything identifying: project name, domain, account handles */
const sanitize = str => str
  .replace(/indie-core-dev/g, 'my-site')
  .replace(/www\.indiecore\.net/g, 'www.example.com')
  .replace(/"indiecore\.net"/g, '"example.com"')
  .replace(/https:\/\/www\.indiecore\.net/g, 'https://www.example.com')
  .replace(/github\.com\/oettaib/g, 'github.com/YOUR-USERNAME');

const README = `# Static site → Cloudflare Workers, with gated deploys

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
are specific to each site. Swap them for your own checks, or drop those steps.

---

Written up in full here: **${POST_URL}**

_Generated from the live configuration — see the post for context._
`;

fs.mkdirSync(OUT, { recursive: true });
const files = {
  '0-README.md':     README,
  'wrangler.jsonc':  sanitize(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')),
  'ci-cd.yml':       sanitize(fs.readFileSync(path.join(ROOT, '.github/workflows/ci-cd.yml'), 'utf8')),
};

for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), content);
}

/* guard: never publish anything identifying */
const LEAKS = ['indiecore.net/blog', 'oettaib', 'indiecode25', 'Othmane', 'Ettaib', '943 647', 'Bretagne'];
const problems = [];
for (const [name, content] of Object.entries(files)) {
  for (const leak of LEAKS) {
    // the one permitted mention is the link back to the post
    if (leak === 'indiecore.net/blog' && name === '0-README.md') continue;
    if (content.toLowerCase().includes(leak.toLowerCase())) problems.push(`${name}: "${leak}"`);
  }
}
if (problems.length) {
  console.error('refusing to write gist files — identifying content found:');
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}

console.log(`gist/ written — ${Object.keys(files).length} files`);
for (const n of Object.keys(files)) console.log(`  ${n}  ${(files[n].length/1024).toFixed(1)} KB`);
