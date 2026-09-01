// Turning a 0-10 rating into something a player can read.
//
// Nobody reads "6.4 / 10, deduction 9.2" and knows what they are in for. This
// is the one place the model becomes language, and every difficulty surface in
// the game reads from here — the level grid, the briefing card, the in-game
// banner. Three surfaces computing their own tiers is three surfaces that
// eventually disagree.
//
// The words are deliberately NOT here. A tier carries a `key` and the caller
// looks it up in the string catalogue, which is what lets the model ship in
// seventeen languages without seventeen copies of the quartiles.

/**
 * Tier boundaries are the pack's own quartiles, not invented round numbers:
 * p25 / p50 / p75 / p90 of the shipped library.
 *
 * That splits 392 boards 23 / 25 / 24 / 15 / 12 percent, so the top tier stays
 * rare enough to mean something when one turns up. Round numbers put 60% of the
 * library in a single tier.
 *
 * Rebuild the pack and these want re-measuring — nothing else will tell you.
 */
export const TIER_BOUNDS = [2.9, 5.1, 6.9, 8.0];

export const TIERS = [
  { key: 'easy',    level: 1, color: '#10b981', deep: '#047857', ink: '#ffffff' },
  { key: 'steady',  level: 2, color: '#38bdf8', deep: '#0369a1', ink: '#062f4a' },
  { key: 'tricky',  level: 3, color: '#f59e0b', deep: '#b45309', ink: '#3b2503' },
  { key: 'hard',    level: 4, color: '#f43f5e', deep: '#9f1239', ink: '#ffffff' },
  { key: 'expert',  level: 5, color: '#a855f7', deep: '#6b21a8', ink: '#ffffff' },
];

/** The tier a 0-10 rating falls in. Unrated boards fall back to the middle. */
export const tierFor = (overall) => {
  if (typeof overall !== 'number' || Number.isNaN(overall)) return TIERS[1];
  let i = 0;
  while (i < TIER_BOUNDS.length && overall >= TIER_BOUNDS[i]) i += 1;
  return TIERS[i];
};

/**
 * The four dimensions behind the single number, each a percentile within the
 * library, all on one 0-10 scale.
 *
 * `sameness` is the one that is not obvious from first principles: a board
 * where six pieces share an outline is harder in a way the other three cannot
 * catch, because the difficulty is not deduction — it is that you cannot see
 * the difference and have to try them.
 *
 * What is left out matters as much. The reference model also lists precision,
 * reaction, memory, time pressure and randomness. This game has no timer, no
 * dexterity and no luck, so those are omitted rather than filled with zeroes —
 * a dimension that is always 0 is a column of noise diluting every weight next
 * to it.
 */
export const DIMENSION_WEIGHTS = {
  deduction: 0.35,   // how often a genuine choice has to be made
  peak: 0.25,        // the worst single decision on the board
  scale: 0.25,       // how much there is to place at all
  sameness: 0.15,    // pieces sharing an outline
};

/**
 * The rating is a prior, not a truth.
 *
 * Every board ships `confidence: 0.2` and `sampleCount: 0` because there are no
 * players yet. This measures the *board*, which is not the same as measuring
 * the difficulty a person experiences.
 *
 * The seam is left open deliberately: when telemetry arrives, blend towards
 * observed difficulty and raise confidence with the sample count, rate-limited
 * so a handful of unusual players cannot move a rating far. Consumers already
 * read `confidence`, so the day it changes nothing downstream is rewritten.
 */
export const isProvisional = (difficulty) => (difficulty?.confidence ?? 0) < 0.5;
