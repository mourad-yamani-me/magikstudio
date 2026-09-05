/**
 * Rankgrip — how tightly a Google Play keyword is already held, 0–100.
 *
 * One number over the four barriers that stand between a listing and a top-ten
 * slot. It runs in the direction of difficulty, like every keyword-difficulty
 * metric people already know: 0 is an open field, 100 is a door that will not
 * move whatever you write.
 *
 * WHY FOUR FACTORS, AND WHY ADDED RATHER THAN MULTIPLIED
 *
 * Each factor is a separate way of holding a term, and they stack rather than
 * gate. A term can be taken from a big developer who has not put the phrase in
 * their title; it can be taken from a title match whose app is three months old
 * and tiny. What cannot be taken is a term where all four are true at once. An
 * average with weights says exactly that — barriers accumulate — where a product
 * would say something false: that any single zero makes a keyword free, which is
 * not what the rankings show.
 *
 *   slot share   0.40  how many of the ten belong to a big developer. The
 *                      heaviest weight because it is the barrier that no amount
 *                      of listing work touches: you are not out-ranking a studio
 *                      with a user-acquisition budget by writing better copy.
 *   title lock   0.25  apps with the phrase in their app name. The single
 *                      strongest on-page signal in Play search, and the one an
 *                      incumbent cannot accidentally give up. Capped at three:
 *                      past that the term is simply theirs and more matches add
 *                      no information.
 *   maturity     0.20  leaders old and large enough to count as established.
 *                      Distinct from tenure below — this is how many are
 *                      entrenched, not how long the oldest has been there.
 *   tenure       0.15  how long the current number one has held the top slot,
 *                      capped at five years. The lightest weight because it is
 *                      the most reversible: a long tenure is evidence of a
 *                      strong position, not a cause of one.
 *
 * The weights are editorial and they are written here rather than buried in a
 * query, because they are the argument the whole series rests on. Change them
 * and every published report silently means something different — so if they
 * ever change, the reports that used the old ones say so.
 *
 * Pure: callers pass facts that are already recorded. No I/O.
 */

/** Big-developer slots at or above which a term is simply not contestable. */
export const SLOT_CAP = 10;
/** Title matches past which more matches say nothing new. */
export const TITLE_CAP = 3;
/** Established leaders counted, out of the ten. */
export const MATURE_CAP = 10;
/** Tenure ceiling, in days. Five years — past this, longer changes nothing. */
export const TENURE_CAP = 1825;

export const WEIGHTS = { slots: 0.40, title: 0.25, mature: 0.20, tenure: 0.15 };

/* The bands. Named so a reader never has to interpret a bare number, and so the
   page can colour a row without a second opinion living in the CSS.

   The cuts are where the data actually separates rather than at tidy thirds:
   see the distribution printed by `npm run aso -- --harvest`. Under 30 nothing
   structural is in the way. Over 70 at least three of the four barriers are up. */
export const BANDS = [
  { max: 29,  key: 'open',  label: 'Open',  note: 'nothing structural in the way' },
  { max: 69,  key: 'tight', label: 'Tight', note: 'a real fight, winnable with a better listing' },
  { max: 100, key: 'held',  label: 'Held',  note: 'no listing rewrite moves this' },
];

export const bandFor = score => BANDS.find(b => score <= b.max) ?? BANDS[BANDS.length - 1];

const clamp01 = n => Math.max(0, Math.min(1, n));
/* A missing fact is scored as absent rather than as zero-risk or worst-case.
   Absent is what it is: nothing observed. Treating an uncrawled keyword as open
   would advertise it as an opportunity on no evidence at all, and treating it as
   held would hide terms nobody has looked at yet. Zero here, with `measured`
   telling the page not to present the number as complete. */
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * @returns {{score:number, band:string, measured:boolean, parts:Record<string,number>}}
 */
export function rankgrip({ big_dev_slots, title_matches, mature_leaders, oldest_leader_days } = {}) {
  const slots  = num(big_dev_slots);
  const title  = num(title_matches);
  const mature = num(mature_leaders);
  const tenure = num(oldest_leader_days);

  const parts = {
    slots:  clamp01((slots  ?? 0) / SLOT_CAP)   * WEIGHTS.slots,
    title:  clamp01((title  ?? 0) / TITLE_CAP)  * WEIGHTS.title,
    mature: clamp01((mature ?? 0) / MATURE_CAP) * WEIGHTS.mature,
    tenure: clamp01((tenure ?? 0) / TENURE_CAP) * WEIGHTS.tenure,
  };
  const score = Math.round((parts.slots + parts.title + parts.mature + parts.tenure) * 100);
  return {
    score,
    band: bandFor(score).key,
    // Every one of the four was actually observed. A row missing any of them is
    // still scored — it just is not presented as a complete measurement.
    measured: [slots, title, mature, tenure].every(v => v !== null),
    parts,
  };
}
