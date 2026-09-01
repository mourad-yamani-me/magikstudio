// The numbers the walk is for.
//
// `walk()` returns one branching factor per step. Everything downstream is
// arithmetic on that list — three numbers ship on every board and are checked
// against the generator's own figures at build time, and the fourth is the one
// the economy needs.

/**
 * The three numbers that ship on every board, plus the one the economy needs.
 *
 * `decisions` is the sum of (choices - 1) over the whole solve — the total
 * count of real choices the board forced. It runs 7.5 on the easiest tier to
 * 96.7 on the hardest, a 13x spread, which is why nothing in the economy is a
 * flat rate.
 */
export const summarise = (steps) => {
  if (!steps.length) return { steps: 0, forced: 0, avg: 0, worst: 0, decisions: 0 };
  const n = steps.map((s) => s.choices);
  return {
    steps: n.length,
    forced: n.filter((x) => x === 1).length / n.length,
    avg: n.reduce((a, b) => a + b, 0) / n.length,
    worst: Math.max(...n),
    decisions: n.reduce((a, b) => a + (b - 1), 0),
  };
};
