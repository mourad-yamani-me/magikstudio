#!/usr/bin/env node
/**
 * Does the post actually contain what it was written to rank for?
 *
 *   npm run keywords                          every post with a topic behind it
 *   npm run keywords -- --only <slug>         one post
 *   npm run keywords -- --topic <id> <slug>   a draft, against a topic it has not claimed yet
 *   npm run keywords -- --list                what each post is supposed to cover
 *
 * ── This is a drafting tool. It is deliberately not in CI. ───────────────────
 *
 * `npm run check` is the gate, and everything in it has to be true of the site
 * as it is deployed. This is a different kind of check: it is the loop you run
 * WHILE writing — draft, run it, see the four phrasings you did not use, work
 * them into prose that was going to exist anyway, run it again. That loop wants
 * to fail, often, on an unfinished file. A gate wants to pass on finished ones.
 * Wiring the same command into both would either make CI red on every draft or
 * soften this one into an advisory nobody reads.
 *
 * So it exits non-zero — an agent writing a post can iterate against it without
 * a human reading the output — and no workflow calls it. `npm run check` does
 * not call it either. Nothing about a merge depends on it.
 *
 * The five posts published before the `seo` block existed carry
 * `seo.exempt` with the reason, and are reported as exempt rather than
 * silently skipped. They were written against a rule that was never enforced;
 * they are already indexed, and rewriting an indexed page to satisfy a check
 * invented afterwards risks the ranking it already has.
 *
 * What it checks, and why those numbers, is in scripts/topic-seo.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KEYWORD_SHARE, MAX_DENSITY, OPENING_WORDS, QUESTION_MIN, QUESTION_SHARE, SLUG_SHARE, TITLE_SHARE, audit, entryForSlug, readLedger, targets } from './topic-seo.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BLOG = path.join(ROOT, 'content/blog');

const args = process.argv.slice(2);
/* indexOf returns -1 when the flag is absent and args[0] is then read as the
   value — the bug that bit `--only` in devto.mjs and `--claim` in schedule.mjs.
   Same guard, same reason. */
const flag = name => {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return null;
  const v = args[at + 1];
  if (!v || v.startsWith('--')) {
    console.error(`--${name} needs a value after it`);
    process.exit(2);
  }
  return v;
};
const only  = flag('only');
const topic = flag('topic');
const list  = args.includes('--list');

const ledger = readLedger();

/* `--topic <id> <slug>` is the drafting case: the post exists, the topic has
   not been claimed yet, and claiming it early would stamp a success condition
   on something that has not shipped. So the pairing is passed in for one run
   and nothing is written. */
let pairs;
if (topic) {
  const slug = args[args.indexOf('--topic') + 2];
  if (!slug || slug.startsWith('--')) {
    console.error('usage: npm run keywords -- --topic <topic-id> <post-slug>');
    process.exit(2);
  }
  const entry = ledger.find(e => e.id === topic);
  if (!entry) { console.error(`no topic with id "${topic}" in content/blog/topics.json`); process.exit(2); }
  pairs = [{ entry, slug }];
} else {
  pairs = ledger.filter(e => e.slug).map(e => ({ entry: e, slug: e.slug }));
  if (only) pairs = pairs.filter(p => p.slug === only);
  if (only && !pairs.length) {
    console.error(`no topic in the ledger claims /blog/${only}/.\n` +
      `  If it is a draft, name the topic it is for:  npm run keywords -- --topic <id> ${only}`);
    process.exit(2);
  }
}

if (!pairs.length) {
  console.log('\n  no post has a topic behind it yet — nothing to check.\n');
  process.exit(0);
}

const pct = n => `${Math.round(n * 100)}%`;
let failed = 0, exempt = 0, passed = 0;

console.log('');
for (const { entry, slug } of pairs) {
  const file = path.join(BLOG, `${slug}.md`);
  if (!fs.existsSync(file)) {
    console.log(`  MISSING  /blog/${slug}/ — content/blog/${slug}.md does not exist`);
    failed++;
    continue;
  }

  const t = targets(entry);

  if (list) {
    console.log(`  /blog/${slug}/  ←  ${entry.id}`);
    console.log(`    primary    ${t.primary}`);
    for (const k of t.keywords)  console.log(`    keyword    ${k}`);
    for (const q of t.questions) console.log(`    question   ${q}`);
    for (const d of (t.declined || [])) console.log(`    declined   ${d.q}  — ${d.why}`);
    if (t.entities.length) console.log(`    entities   ${t.entities.join(', ')}`);
    console.log(`    core       ${t.core.join(', ')}  (must reach the title and the slug)`);
    console.log('');
    continue;
  }

  /* Printed before the verdict, and on a pass as well as a failure. A subject
     that declines half its questions should look different at a glance from one
     that answered them, or the field becomes a way to make anything pass. */
  if (t.declined?.length) {
    console.log(`  declined /blog/${slug}/ — ${t.declined.length} question(s) this subject does not answer:`);
    for (const d of t.declined) console.log(`             "${d.q}"\n               because ${d.why}`);
  }

  if (t.exempt) {
    console.log(`  exempt   /blog/${slug}/ — ${t.exempt}`);
    exempt++;
    continue;
  }

  const a = audit(t, fs.readFileSync(file, 'utf8'), slug);

  if (a.ok) {
    console.log(`  ok       /blog/${slug}/ — keywords ${pct(a.keywords.share)}, questions ${pct(a.questions.share)}, ` +
      `title ${pct(a.placement.title)}, slug ${pct(a.placement.slug)}, ` +
      `density ${(a.placement.density * 100).toFixed(2)}%` +
      `  ·  opening ${pct(a.placement.opening)} (not enforced)`);
    /* Said out loud rather than left to look like a pass. A thin harvest means
       the subject was not measured, not that the post answered everything. */
    if (a.questions.thin) console.log(`             note: only ${t.questions.length} question(s) harvested ` +
      `(under ${QUESTION_MIN}), so that gate did not apply. ` +
      `\`npm run topics -- --harvest=${entry.id} --revalidate\` may find more.`);
    passed++;
    continue;
  }

  failed++;
  console.log(`  FAIL     /blog/${slug}/`);
  for (const p of a.problems) {
    console.log(`    ${p.say}`);
    console.log(`    → ${p.fix}`);
    for (const m of p.missing) console.log(`        missing:  ${m}`);
    console.log('');
  }
  if (a.entities.missing.length) {
    console.log(`    (not enforced) entities the subject is made of that the post never names: ` +
      a.entities.missing.join(', '));
    console.log('');
  }
}

if (list) process.exit(0);

const parts = [`${passed} ok`, `${failed} failing`];
if (exempt) parts.push(`${exempt} exempt`);
console.log(`\n  ${parts.join(', ')}\n`);

if (failed) {
  console.log('  What is required, all of it measured against this repo\'s own posts:\n' +
    `    the primary phrase verbatim, ${KEYWORD_SHARE * 100}% of keywords verbatim, ` +
    `${QUESTION_SHARE * 100}% of questions under a heading\n` +
    `    ${TITLE_SHARE * 100}% of the subject in the title and ${SLUG_SHARE * 100}% in the slug\n` +
    `    and the phrase under ${MAX_DENSITY * 100}% of the body\n\n` +
    '  Nothing in CI runs this — fix it while you write.\n');
  process.exit(1);
}
