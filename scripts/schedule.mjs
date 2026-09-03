#!/usr/bin/env node
/**
 * The publishing queue and the calendar it runs on.
 *
 *   npm run schedule                                  # the queue, and the next free days
 *   npm run schedule -- --claim <slug>                # take the next free slot
 *   npm run schedule -- --claim <slug> --on <date>    # take a specific day
 *   npm run schedule -- --claim <slug> --release      # give a slot back
 *
 * A post carries the date it comes out in its frontmatter, and build.mjs holds
 * anything dated ahead of today. So publishing later needs no human on the day
 * — it needs a build on the day. ci-cd.yml runs one daily and asks this script
 * whether that build is worth deploying.
 *
 * "Worth deploying" is not "a post is dated today". A cron can be delayed, a
 * runner can fail, and GitHub disables schedules on a repo that goes quiet —
 * any of which would make a post dated today the only one ever noticed and
 * leave yesterday's held forever. So the question asked is the one that matters:
 * is there a post whose date has arrived and that the live site does not serve?
 * That answer is self-correcting, and it is also empty on every ordinary day,
 * which is what keeps the daily run from redeploying an unchanged site.
 *
 * Exits 0 whether or not anything is due; the answer is the `due` output, not
 * the exit code. A failure to reach the site is not a failure of this script
 * either — it falls back to the date, says so, and lets the build run.
 *
 * Which day a new post may take is not this file's decision: the calendar is in
 * scripts/schedule-rule.mjs, and the build enforces the same rule from the same
 * module, so a slot handed out here can never be one the build refuses.
 */
import fs from 'node:fs';
import { calendar, posts, quotaFor, readLedger, violations, writeLedger } from './schedule-rule.mjs';

const SITE  = 'https://www.indiecore.net';
const TODAY = new Date().toISOString().slice(0, 10);   // UTC, same clock as the build

const args    = process.argv.slice(2);
const claimAt = args.indexOf('--claim');
const onAt    = args.indexOf('--on');
/* -1 + 1 is 0, which reads the first argument as the value and claims a slot
   for a slug nobody named. The same shape that bit `--only` in devto.mjs. */
const claim   = claimAt === -1 ? null : args[claimAt + 1];
const on      = onAt    === -1 ? null : args[onAt + 1];
const release = args.includes('--release');
if ((claimAt !== -1 && (!claim || claim.startsWith('--'))) ||
    (onAt    !== -1 && !/^\d{4}-\d{2}-\d{2}$/.test(on ?? ''))) {
  console.error('usage: npm run schedule -- --claim <post-slug> [--on YYYY-MM-DD] [--release]');
  process.exit(1);
}

const ledger = readLedger();
const { rule } = ledger;
const all = posts();

/* How many of a day's slots are spoken for. A claim and the post that fills it
   are the same reservation seen twice, so they are counted as one — and an
   override does not count at all, which is the whole point of an override. */
const overridden = new Set(all.filter(p => p.override).map(p => p.slug));
const takenOn = (date, ignore = null) => {
  const held = new Set(ledger.claims[date] ?? []);
  for (const p of all) if (p.date === date) held.add(p.slug);
  // `ignore` is the slug being claimed. A post already dated to this day is its
  // own reservation, so counting it would report "slot 2 of 1" for the only
  // post on the day and refuse to hand out the slot it already holds.
  return [...held].filter(s => s !== ignore && !overridden.has(s));
};

/* ───────── claiming ───────── */

if (claim) {
  const where = Object.entries(ledger.claims).find(([, list]) => list.includes(claim))?.[0];

  if (release) {
    if (!where) { console.error(`  ${claim} holds no slot.`); process.exit(1); }
    ledger.claims[where] = ledger.claims[where].filter(s => s !== claim);
    if (!ledger.claims[where].length) delete ledger.claims[where];
    writeLedger(ledger);
    console.log(`  released ${where} — ${claim} no longer holds a slot.`);
    process.exit(0);
  }

  if (where && where !== on) {
    // Claiming twice is nearly always a re-run, not a request for a second day.
    console.log(`  ${claim} already holds ${where}. Use --release first to move it.`);
    process.exit(0);
  }

  const from = [TODAY, rule.from].sort().at(-1);
  let date = on;
  if (!date) {
    date = calendar(from, 400, rule).find(d => takenOn(d.date, claim).length < d.quota)?.date;
    if (!date) { console.error('  no free slot in the next year — raise the monthly range.'); process.exit(1); }
  }

  const quota = quotaFor(date, rule);
  const taken = takenOn(date, claim).length;
  ledger.claims[date] = [...new Set([...(ledger.claims[date] ?? []), claim])];
  writeLedger(ledger);

  console.log(`\n  claimed ${date} for ${claim} — slot ${taken + 1} of ${quota}\n`);
  console.log(`  put it in the frontmatter:   date: ${date}`);
  if (quota === 0) console.log(
    `  ${date} is the day off. The build will refuse it unless the post carries\n` +
    '  `schedule: <reason>` — use that only for something that must go out that day.');
  else if (taken >= quota) console.log(
    `  that day is already full (${taken}/${quota}). The build will refuse the post unless it\n` +
    '  carries `schedule: <reason>` saying why it could not wait.');
  process.exit(0);
}

/* ───────── the queue ───────── */

const dated = all.filter(p => !p.draft && /^\d{4}-\d{2}-\d{2}$/.test(p.date ?? ''));
const held  = dated.filter(p => p.date > TODAY);
const out   = dated.filter(p => p.date <= TODAY);

/* The sitemap lists every published post and nothing else, so it is the
   cheapest honest answer to "what is actually live" — one request, no HTML
   parsing, and no 404 storm from probing each URL in turn. */
let liveSlugs = null;
try {
  const res = await fetch(`${SITE}/sitemap.xml`, { headers: { 'user-agent': 'indiecore-schedule' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  liveSlugs = new Set([...xml.matchAll(/\/blog\/([^/<]+)\//g)].map(m => m[1]));
} catch (e) {
  console.log(`  could not read ${SITE}/sitemap.xml (${e.message}) — falling back to the date alone`);
}

const missing = liveSlugs
  ? out.filter(p => !liveSlugs.has(p.slug))
  : out.filter(p => p.date === TODAY);

console.log(`\n  today is ${TODAY} (UTC) · ${out.length} published · ${held.length} held\n`);
for (const p of held)    console.log(`  held   /blog/${p.slug}/ — publishes ${p.date}`);
for (const p of missing) console.log(`  due    /blog/${p.slug}/ — dated ${p.date}, not live yet`);

console.log(missing.length
  ? `\n  ${missing.length} post(s) due — a deploy would put ${missing.length === 1 ? 'it' : 'them'} out.`
  : held.length
    ? `\n  nothing due today. Next: /blog/${held[0].slug}/ on ${held[0].date}.`
    : '\n  nothing due, nothing held.');

/* The next fortnight of the calendar, so the state of the queue and the room
   left in it are one glance rather than two commands. */
console.log(`\n  the calendar — ${rule.perDay[0]}–${rule.perDay[1]} a day, ` +
  `${rule.perMonth[0]}–${rule.perMonth[1]} a month, ` +
  `${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][rule.dayOff]}s off\n`);
for (const { date, quota } of calendar([TODAY, rule.from].sort().at(-1), 12, rule)) {
  const taken = takenOn(date);
  const bar = '●'.repeat(taken.length) + '○'.repeat(Math.max(0, quota - taken.length));
  console.log(`  ${date}  ${bar.padEnd(4)}  ${taken.length}/${quota}${taken.length ? '  ' + taken.join(', ') : ''}`);
}

const { errors, warnings, overrides } = violations(ledger, all);
for (const o of overrides) console.log(`\n  override  ${o}`);
for (const w of warnings)  console.log(`  warn      ${w}`);
if (errors.length) {
  console.error('\n  the calendar is broken — the build will refuse this:\n');
  for (const e of errors) console.error(`  error     ${e}`);
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `due=${missing.length ? 'true' : 'false'}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `slugs=${missing.map(p => p.slug).join(' ')}\n`);
}
