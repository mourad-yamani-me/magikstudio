// A coin economy priced off the difficulty model, as data and pure functions.
//
// Nothing in here touches React, the store, or storage. That is not tidiness —
// it is what lets the balance SIMULATOR import the same module. A simulator
// that re-implements the economy tells you about a game you are not shipping,
// and it diverges on the first tuning pass, silently, because nothing connects
// them.
//
// WHERE THE NUMBERS COME FROM
//
// A level's difficulty is its DECISION LOAD: walk the board the way the
// difficulty model does — fill the topmost-leftmost empty cell, count how many
// pieces in hand could go there — and sum (choices - 1) over every step.
//
// It runs 7.5 on the easiest tier to 96.7 on the hardest. A 13x spread, which
// is why nothing here is a flat rate. The first version paid 20 coins for
// finishing a level, every level, and taught players to grind the easy end.

/** Board size bands. Pieces per board runs 4..30, median 15. */
export const BANDS = ['S', 'M', 'L'];
export const bandFor = (pieceCount) => (pieceCount <= 9 ? 'S' : pieceCount <= 17 ? 'M' : 'L');

// ---------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------

/**
 * What a first clear pays.
 *
 * Tied to the decision load rather than the 0-10 rating, and the distinction is
 * deliberate: the rating is a percentile — a comparison against other levels —
 * while the decision load is an absolute count of work done. Coins pay for work.
 *
 * Yields 8 coins on an Easy board, 35 on an Expert one. The floor exists so a
 * tiny 3x3 still feels like it paid something; the slope is what makes a hard
 * board worth choosing.
 */
export const CLEAR_BASE = 6;
export const CLEAR_PER_DECISION = 0.30;

export const clearReward = (decisionLoad) =>
  Math.round(CLEAR_BASE + CLEAR_PER_DECISION * decisionLoad);

/**
 * Star bonuses, paid as a DELTA against the highest tier ever banked for that
 * level. Replaying a 3-star level pays nothing; dragging a 1-star up to 3 pays
 * the difference once and never again.
 *
 * Without the delta, replaying your easiest completed level is the optimal way
 * to earn — a broken economy and a boring game.
 *
 * These are deliberately small. Simulation put star bonuses at 45% of ALL
 * income — the single largest faucet, larger than clears, ads or the daily
 * chest — while three stars is earned on about two thirds of levels. A generous
 * bonus here is a tax-free salary rather than a reward for excellence.
 *
 * The top delta is also the ceiling on what any single purchase can unlock, so
 * it sets the price floor: if a hint costs less than this, the optimal strategy
 * is to buy hints until three stars is guaranteed, forever, and the economy
 * becomes a vending machine.
 */
export const STAR_BONUS = { 0: 0, 1: 0, 2: 6, 3: 18 };

export const starDelta = (stars, tierAlreadyPaid) =>
  Math.max(0, (STAR_BONUS[stars] ?? 0) - (STAR_BONUS[tierAlreadyPaid] ?? 0));

/**
 * Rewarded-video multiplier on a first clear. Never offered on a replay.
 *
 * A multiplier rather than a flat coin amount, so the ad reward inherits the
 * difficulty scaling for free: doubling a 35-coin Expert clear is worth
 * watching, doubling an 8-coin Easy one is not, and the player self-selects.
 * A flat "watch for 25 coins" inverts that — farm the easiest level, watch,
 * repeat.
 */
export const DOUBLER = 2;
export const PEAK_DOUBLER = 3;

/**
 * Daily login chest: a 7-day cycle that grows a little each time it completes,
 * then STOPS.
 *
 * The escalation is capped because the version this replaced multiplied without
 * limit — by the eighth cycle its day-7 chest paid 225 coins, more than three
 * level clears, for opening the app. Retention rewards should be worth showing
 * up for and never worth more than playing.
 */
export const DAILY_CHEST = [20, 22, 25, 28, 32, 40, 70];
export const CHEST_GROWTH = 0.2;
export const CHEST_MAX_CYCLES = 2;

export const dailyChest = (totalDaysClaimed = 0) => {
  const cycle = Math.min(CHEST_MAX_CYCLES, Math.floor(totalDaysClaimed / DAILY_CHEST.length));
  const day = totalDaysClaimed % DAILY_CHEST.length;
  return Math.round(DAILY_CHEST[day] * (1 + CHEST_GROWTH * cycle));
};

// ---------------------------------------------------------------------------
// The invariants the simulator asserts (--test), rather than numbers it prints
// ---------------------------------------------------------------------------
//
//   - no sequence of legitimate actions produces unbounded coins
//   - every purchasable item is reachable within a bounded number of levels
//     from zero
//   - replaying a completed level never nets positive
//   - the difficulty walk these prices are computed from still matches the
//     metrics shipped on every board
//
// The last one is the join to the rest of the system. Prices derive from the
// same walk that rates the levels and drives the power-ups. If that walk drifts,
// the game keeps running and every price silently becomes wrong.
