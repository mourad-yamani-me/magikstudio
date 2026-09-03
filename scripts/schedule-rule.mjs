/**
 * The publishing calendar: how many posts a given day may carry, who has
 * claimed which day, and what is currently in violation.
 *
 * Shared on purpose. The allocator (scripts/schedule.mjs) and the gate
 * (build.mjs) have to agree exactly — a rule that hands out a slot the build
 * then refuses is worse than having no rule at all.
 *
 * The quotas are drawn, not written down. A calendar file listing every day of
 * the next year is a file someone has to extend every December and edit every
 * time the numbers change; a draw seeded on the date itself is the same
 * calendar, derived, and it never runs out. `Math.random()` would make the
 * calendar different on every run — the same commit passing CI once and failing
 * the next time — so the seed is the date string and nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve(import.meta.dirname, '..');
export const LEDGER = path.join(ROOT, '_source/schedule.json');
export const BLOG   = path.join(ROOT, 'content/blog');

/* ───────── the draw ───────── */

/* FNV-1a over the seed string, then mulberry32. Both are chosen for being
   short enough to read and identical on every engine — this has to produce the
   same calendar on a laptop and on the runner, this year and in three years. */
const hash = s => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};
const rng = seed => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const today = () => new Date().toISOString().slice(0, 10);

/** Every posting day of a month, in order. The day off is skipped entirely. */
function monthDays(ym, rule) {
  const [y, m] = ym.split('-').map(Number);
  const out = [];
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== rule.dayOff) out.push(iso(d));
  }
  return out;
}

/* One month, planned in one go: the month's own total is drawn first, then
   spread over its posting days. Drawing each day independently would have made
   the monthly total whatever it happened to be — this way both the month and
   the day vary, which is what was asked for, and neither can drift outside its
   range. */
const planCache = new Map();
export function monthPlan(ym, rule) {
  const key = `${ym}|${JSON.stringify(rule)}`;
  if (planCache.has(key)) return planCache.get(key);

  const days = monthDays(ym, rule);
  const [dmin, dmax] = rule.perDay;
  const [mmin, mmax] = rule.perMonth;
  const r = rng(hash(`${ym}|${mmin}-${mmax}|${dmin}-${dmax}|${rule.dayOff}`));

  // Clamped, not trusted: a monthly range the daily one cannot reach (60 a
  // month out of 26 days that hold 1 each) would otherwise silently under-fill.
  const total = Math.min(Math.max(mmin + Math.floor(r() * (mmax - mmin + 1)),
                                  days.length * dmin), days.length * dmax);

  const quota = Object.fromEntries(days.map(d => [d, dmin]));
  let extra = total - days.length * dmin;

  /* Hand the surplus out a day at a time, in shuffled order, taking a random
     share of what is left rather than one each in rounds. Rounds would fill
     every day to two before any day saw three, which is a flat calendar wearing
     a random coat. `mustTake` is what this day has to absorb for the days after
     it to still hold the rest — it is what keeps the month's total exact. */
  const order = [...days];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < order.length && extra > 0; i++) {
    const room     = dmax - dmin;
    const daysLeft = order.length - i - 1;
    const mustTake = Math.max(0, extra - daysLeft * room);
    const canTake  = Math.min(room, extra);
    const take     = mustTake + Math.floor(r() * (canTake - mustTake + 1));
    quota[order[i]] += take;
    extra -= take;
  }
  planCache.set(key, quota);
  return quota;
}

/** How many posts `date` (YYYY-MM-DD) may carry. 0 on the day off. */
export const quotaFor = (date, rule) => monthPlan(date.slice(0, 7), rule)[date] ?? 0;

/** The next `n` posting days from `date`, inclusive. */
export function calendar(from, n, rule) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (out.length < n) {
    const date = iso(d);
    const quota = quotaFor(date, rule);
    if (quota > 0) out.push({ date, quota });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ───────── the ledger ───────── */

export const readLedger = () => JSON.parse(fs.readFileSync(LEDGER, 'utf8'));

export const writeLedger = l => {
  // Dates sorted, so a claim lands where it belongs in the diff rather than at
  // the end of the file, and two branches claiming different days merge cleanly.
  const claims = Object.fromEntries(Object.entries(l.claims).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(LEDGER, JSON.stringify({ ...l, claims }, null, 2) + '\n');
};

const field = (src, key) => src.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))?.[1]
  ?.replace(/^["']|["']$/g, '');

/** Every post, with only the fields the schedule cares about. */
export function posts() {
  return fs.readdirSync(BLOG)
    .filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .map(f => {
      const src = fs.readFileSync(path.join(BLOG, f), 'utf8');
      return {
        slug: f.replace(/\.md$/, ''),
        date: field(src, 'date'),
        draft: field(src, 'draft') === 'true',
        // Any non-empty value is an override; the value is the reason, and it
        // is there to be read in the diff and in the build log.
        override: field(src, 'schedule') || '',
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.slug.localeCompare(b.slug));
}

/* ───────── the gate ───────── */

/**
 * Everything wrong with the calendar right now, as a list of one-line messages
 * that each name their own fix. Posts dated before `rule.from` are not checked:
 * the rule ships with an archive that predates it, and rewriting the dates of
 * pages Google has already crawled to satisfy a new rule would cost more than
 * the tidiness is worth.
 */
export function violations({ rule, claims } = readLedger(), all = posts()) {
  const errors = [];
  const warnings = [];
  const overrides = [];

  const scheduled = all.filter(p => p.date && p.date >= rule.from);
  const byDate = new Map();
  for (const p of scheduled) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);

  for (const [date, ps] of [...byDate].sort()) {
    const quota = quotaFor(date, rule);
    const counted = ps.filter(p => !p.override);
    for (const p of ps.filter(p => p.override)) overrides.push(`${p.slug} on ${date} — ${p.override}`);

    if (quota === 0 && counted.length) errors.push(
      `${date} is the day off, but ${counted.map(p => p.slug).join(', ')} ${counted.length > 1 ? 'are' : 'is'} dated to it` +
      ` — run \`npm run schedule -- --claim ${counted[0].slug}\` for the next free day.`);
    else if (counted.length > quota) errors.push(
      `${date} holds ${counted.length} posts and its quota is ${quota}: ${counted.map(p => p.slug).join(', ')}` +
      ` — re-claim the extra one, or add \`schedule: <reason>\` to it if it has to go out that day.`);

    const claimed = new Set(claims[date] ?? []);
    for (const p of ps) if (!claimed.has(p.slug)) errors.push(
      `${p.slug} is dated ${date} but nothing claimed that slot` +
      ` — run \`npm run schedule -- --claim ${p.slug} --on ${date}\` to record it.`);
  }

  const slugs = new Map(all.map(p => [p.slug, p]));
  for (const [date, list] of Object.entries(claims)) {
    if (date < rule.from) continue;
    for (const slug of list) {
      const p = slugs.get(slug);
      if (!p) {
        // A claim ahead of its post is the point of the ledger — you reserve
        // the day, then write. A claim whose day has passed with no post is
        // just a slot nobody used.
        if (date < today()) warnings.push(`claim ${slug} on ${date} never became a post — remove it to free the slot`);
      } else if (p.date !== date) errors.push(
        `${slug} is claimed on ${date} but dated ${p.date}` +
        ` — the ledger and the post have to agree; fix whichever is wrong.`);
    }
  }

  return { errors, warnings, overrides };
}
