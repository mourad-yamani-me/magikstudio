#!/usr/bin/env node
/**
 * Fails when a committed generated directory no longer matches its source.
 *
 * `gist/` and `hub/` are generated but committed, so a change to a file they
 * mirror leaves them stale until someone remembers to re-run the generator.
 * Nobody did, twice:
 *
 *   - `gist/build-gates/verify.mjs` sat a commit behind `scripts/verify.mjs`
 *     through the whole accessibility fix.
 *   - `gist/cloudflare-workers/ci-cd.yml` went stale the moment `hub/**` was
 *     added to the deploy trigger, in the same PR that generated it.
 *
 * That used to cost nothing much: sync-gist.yml regenerates before publishing,
 * so the live gists were right even when the repo's copy was not. It stopped
 * being harmless when scripts/devto.mjs started composing articles out of
 * these files — a stale gist/ now means a published article containing code
 * this repo does not run, which is the exact drift the generators exist to
 * prevent.
 *
 * Runs as part of `npm run check`. The fix it names is one command.
 */
import { execFileSync } from 'node:child_process';

const GENERATED = [
  { dir: 'gist', script: 'scripts/build-gist.mjs', fix: 'npm run gist' },
  { dir: 'hub',  script: 'scripts/build-hub.mjs',  fix: 'npm run hub'  },
];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

/* Only meaningful against a clean checkout of the directory in question: with
   uncommitted edits already there, the diff below cannot tell "someone forgot
   to regenerate" from "someone is mid-change". Say so rather than reporting a
   failure that is really the working tree. */
let dirtyBefore;
try {
  dirtyBefore = new Set(
    git('status', '--porcelain', '--', ...GENERATED.map(g => g.dir))
      .split('\n').filter(Boolean).map(l => l.slice(3).split('/')[0]),
  );
} catch {
  console.log('  generated dirs: not a git checkout, skipping freshness check');
  process.exit(0);
}

const stale = [];

for (const { dir, script, fix } of GENERATED) {
  if (dirtyBefore.has(dir)) {
    console.log(`  ${dir}/ has uncommitted changes — freshness not checked`);
    continue;
  }
  execFileSync('node', [script], { stdio: 'pipe' });
  const changed = git('status', '--porcelain', '--', dir).split('\n').filter(Boolean);
  if (changed.length) stale.push({ dir, fix, changed: changed.map(l => l.slice(3)) });
}

if (stale.length) {
  console.error('');
  for (const s of stale) {
    console.error(`  ERROR  ${s.dir}/ is stale — regenerating it changes:`);
    s.changed.forEach(f => console.error(`           ${f}`));
    console.error(`         run \`${s.fix}\` and commit the result.`);
  }
  console.error('');
  process.exit(1);
}

console.log('  generated dirs up to date');
