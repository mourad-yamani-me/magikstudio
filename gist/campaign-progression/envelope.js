// The envelope: what difficulty a campaign slot asks for.
//
// The central rule this implements: a level's difficulty rating must not decide
// its position. Difficulty RATES a level; progression PLACES it. The library is
// a pool, each slot asks for something, and the best level still in the pool is
// chosen on difficulty, role, ramp and variety together.
//
// Composed with the rhythm (beats.js) and the tone windows (tones.js) into one
// PROGRESSION object, so everything tunable is out of the algorithm.

// Bumping this changes WHICH level each stage number refers to. Level numbers
// are the player's saved progress, so they keep their completed count and those
// numbers now point at different levels. Only bump it alongside a pack change
// or a deliberate progress migration.
export const MODEL_VERSION = 'blocks-progression-2';

export const ENVELOPE = {
  version: MODEL_VERSION,

  // The opening levels teach and calibrate rather than challenge: small boards,
  // little deduction, strictly increasing so nothing surprises a new player.
  calibration: 6,

  // A slot's target is a QUANTILE of the levels still unplayed, and `anchor` is
  // the designed curve that quantile follows across the campaign.
  //
  // It has to be a quantile and not the minimum. Anchoring to the easiest level
  // still unplayed sounds equivalent and is not: the pool is consumed roughly
  // easiest-first, so the minimum creeps up one level at a time and the target
  // creeps with it. That is a sort wearing a rhythm, and it produced exactly
  // the failure this replaced — all 92 Easy boards inside the first 138 levels,
  // no Tricky board until level 133.
  //
  // A quantile sits above the easy tail instead of on it. The tail then gets
  // picked up later by the wave's dips and the recovery beats, which is where an
  // easy board actually belongs.
  //
  // `shape` below 1 rises fast early, which is what gets a new player out of the
  // shallow end. The counts still work out because the anchor reads what is
  // left, not what was there at the start.
  anchor: { from: 0.08, to: 0.82, shape: 1.1 },

  // Bands overlap between neighbouring regions by construction: a slot's band is
  // wide enough that consecutive slots share most of their candidates, so there
  // is no wall at any boundary.
  band: 1.5,
  bandGrowth: 0.9,
};
