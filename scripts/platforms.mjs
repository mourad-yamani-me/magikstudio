/**
 * How many posts each channel may carry, and which posts get the slots.
 *
 * The site's calendar has always been scarce on purpose — one to three posts a
 * day, drawn in scripts/schedule-rule.mjs. The two other channels were scarce
 * too, but for reasons that had nothing to do with editorial judgement: dev.to
 * drips because Forem rate-limits new accounts, LinkedIn posts one a run
 * because two links a minute apart read as a bot. Both limits are about not
 * getting suspended.
 *
 * What no limit answered was *which* post takes the slot. Both scripts sorted
 * their queue by date and took the front of it, so the scarce reach went to
 * whatever was written first. With 98 validated subjects waiting and a handful
 * of slots a week, ordering by date is the same as ordering at random.
 *
 * So the order is demand, and the flags stay a veto:
 *
 *   - `devto: false` / `linkedin: false` still means never. A flag is a veto,
 *     not a vote, and nothing here can overrule one. That is what keeps the
 *     required-`linkedin` decision (commit 4afad9f) meaningful.
 *   - Among the posts that opted in, the highest-ranked subject goes first.
 *     Rank is scripts/topic-seo.mjs — logged demand, winnability, discovery.
 *   - A post with no topic behind it ranks last rather than not at all. Several
 *     posts predate the ledger and they should still go out, just not ahead of
 *     a subject with five thousand readers a year attached to it.
 *
 * The per-channel quotas live in `_source/schedule.json` beside the site's own
 * rule, because "how much do we publish, and where" is one question and
 * splitting it across three files is how the answers drift apart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { entryForSlug, rank } from './topic-seo.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCHEDULE = path.join(ROOT, '_source/schedule.json');

/* Used when `_source/schedule.json` carries no `platforms` block, so an older
   checkout keeps working rather than posting nothing. They are the caps the two
   scripts already applied by hand, written down. */
const DEFAULTS = {
  devto:    { perRun: 3, perWeek: 5 },
  linkedin: { perRun: 1, perWeek: 3 },
};

export function platformRule(name) {
  let block = {};
  try { block = JSON.parse(fs.readFileSync(SCHEDULE, 'utf8')).platforms || {}; } catch { /* defaults */ }
  return { ...DEFAULTS[name], ...(block[name] || {}) };
}

const WEEK = 7 * 864e5;

/** How many of this week's slots are already spent, given the dates things went out. */
export function spentThisWeek(dates, today = new Date().toISOString().slice(0, 10)) {
  const cutoff = new Date(new Date(today).getTime() - WEEK);
  return dates.filter(d => d && new Date(d) > cutoff).length;
}

/**
 * The cap for one run: the smaller of what the channel's own safety limit
 * allows and what is left of the week.
 *
 * Both matter and they guard different things. The safety limit is about the
 * platform suspending the account; the weekly quota is about the feed. Taking
 * the minimum means neither can be exceeded by satisfying the other, and the
 * reason is reported rather than inferred from a number that came out small.
 *
 * @returns {{cap: number, why: string}}
 */
export function capFor(name, { safety, posted = [], today }) {
  const rule = platformRule(name);
  const perRun = Math.min(safety ?? rule.perRun, rule.perRun);
  const left = Math.max(0, rule.perWeek - spentThisWeek(posted, today));
  const cap = Math.min(perRun, left);
  const why = left === 0
    ? `${rule.perWeek} a week is spent — nothing goes out until a slot frees up`
    : cap === left && left < perRun
      ? `${left} of ${rule.perWeek} weekly slots left`
      : `${perRun} a run${safety !== undefined && safety < rule.perRun ? ' (platform safety limit)' : ''}, ${left} of ${rule.perWeek} weekly slots left`;
  return { cap, why };
}

/**
 * Order posts by how much traffic their subject is worth, best first.
 *
 * Each item needs a `slug`; `date` is used only to break ties, oldest first, so
 * two subjects of equal weight still come out in the order they were written.
 *
 * @returns the same items, each with `{rank, why}` attached
 */
export function byDemand(items, ledger, dateOf = i => i.meta?.date ?? i.date ?? '') {
  return items
    .map(i => {
      const entry = entryForSlug(ledger, i.slug);
      /* rank() reports `eligible: false` for anything already published, which
         is every post reaching this function — the flag answers "may this be
         written", not "how good is it". Only the number is wanted here. */
      const r = entry ? rank(entry) : { rank: 0, why: 'no topic in the ledger — ranked last' };
      return { ...i, rank: r.rank, why: r.why };
    })
    .sort((a, b) => b.rank - a.rank || String(dateOf(a)).localeCompare(String(dateOf(b))));
}
