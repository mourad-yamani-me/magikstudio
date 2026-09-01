// Tone windows, the wave, and the speed limits.
//
// Where each tone sits relative to the anchor, in multiples of `band`. Four
// different ranges, not one band around one number.

export const TONES = {
  // GETTING THIS WRONG IS WHAT STACKS THE EASY BOARDS. A single symmetric band
  // makes an easy level *ineligible* the moment the anchor climbs past it, so
  // the whole easy tail sits untouchable through the middle of the campaign and
  // then has nowhere to go but the end. Comfort and recovery reaching properly
  // below the anchor is what keeps draining it.
  //
  // `loEnd` tapers the downward reach across the campaign. Comfort has to reach
  // a long way below the anchor early — that is the drainage — but the same
  // reach late drops a Steady board into level 325, which reads as a bug rather
  // than a breather. Early it is drainage; late it closes.
  comfort:   { lo: -2.7, loEnd: -1.6, hi:  0.1  },
  challenge: { lo: -0.05,             hi:  0.95 },
  milestone: { lo:  0.7,              hi:  1.9  },
  recovery:  { lo: -2.0, loEnd: -1.4, hi: -0.5  },
};

// The rhythm barely opens up across the campaign. Damping it early turned out to
// be the wrong protection — it flattened the first hundred levels into one long
// shallow run. Beginners need no SPIKES, not a flat curve, and `firstMilestone`
// does that on its own by treating an early milestone slot as a comfort one.
export const WAVE = { from: 1.0, to: 1.15, firstMilestone: 16 };

// How far difficulty may move between consecutive levels, which is what stops
// the 8.0 -> 3.0 -> 8.0 oscillation a naive rhythm produces.
//
// Asymmetric on purpose: dropping into a recovery level should be allowed to
// feel like a drop, while a jump upward has to be earned by the rhythm rather
// than arriving because the pool happened to be thin.
export const STEP = { up: 2.2, down: 3.4 };

// NOT BUILT, and the seams are marked rather than left to be found again.
//
// The model this follows describes a runtime engine fed by telemetry: a player
// skill model, win/loss streaks, session shaping, difficulty updated from
// observed behaviour. None of it can exist before there are players, and level
// numbers are saved progress, so the order has to be identical for everyone and
// stable across launches.
//
//   targetFor()  takes the envelope — where a skill target would blend in
//   score()      where a skill-dimension fit would be added
export const SEAMS = ['targetFor', 'score'];
