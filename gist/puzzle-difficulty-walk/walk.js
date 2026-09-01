// Rating a fitting puzzle by the decisions it forces.
//
// The player never sees the answer, so the board is a fitting problem and its
// difficulty is how much has to be worked out. That suggests a procedure, and
// the procedure is what a person actually does with a jigsaw:
//
//     fill the topmost-leftmost empty cell,
//     count how many pieces still in hand could go there.
//
// One means the board placed the piece for you and cost you nothing. Five means
// a real decision, and a wrong answer that will have to be undone.
//
// Everything downstream is arithmetic on the list this returns: the difficulty
// rating, the coin reward, and the two power-ups (place a piece / flag a wrong
// one) which are this same walk with a different question asked of it.
//
// Cost: at most ~30 pieces per board, so a walk is a few thousand cell tests.
// Well under a frame on a phone.

/** Occupied cells of a piece, relative to its own bounding box. */
export const pieceCells = (piece) => {
  const out = [];
  piece.shape.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch !== '.') out.push({ r, c, ch });
    });
  });
  return out;
};

// Memoised onto the piece. Boards arrive from two places — a script reading the
// pack off disk, and a fetch in the browser — and only the first had any reason
// to decorate them. Going through this means a board works the same whichever
// door it came in.
const cellsOf = (piece) => {
  if (!piece._cells) piece._cells = pieceCells(piece);
  return piece._cells;
};

/**
 * Walk a board and return the branching factor at each step.
 *
 * `preplaced` models a power-up that puts a piece down for the player.
 * `revealedRows` / `revealedCols` model a hint that shows true letters: a
 * candidate piece must then match every revealed letter it would cover.
 */
export const walk = (board, { preplaced = [], revealedRows = null, revealedCols = null } = {}) => {
  const R = board.rows;
  const C = board.cols;
  const occ = Array.from({ length: R }, () => new Array(C).fill(null));
  const hand = new Map();
  for (const p of board.pieces) hand.set(p.id, p);

  const put = (p) => {
    const [hr, hc] = p.home;
    for (const { r, c } of cellsOf(p)) occ[hr + r][hc + c] = p.id;
    hand.delete(p.id);
  };
  for (const id of preplaced) if (hand.has(id)) put(hand.get(id));

  const known = (r, c) => Boolean(revealedRows?.has(r)) || Boolean(revealedCols?.has(c));
  const steps = [];

  while (hand.size) {
    // The topmost-leftmost empty cell is the next thing to fill.
    let tr = -1;
    let tc = -1;
    outer: for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (occ[r][c] === null) { tr = r; tc = c; break outer; }
      }
    }
    if (tr < 0) break;

    // How many pieces in hand could legally cover that cell, at any offset.
    let choices = 0;
    for (const p of hand.values()) {
      let fits = false;
      for (const anchor of cellsOf(p)) {
        const or = tr - anchor.r;
        const oc = tc - anchor.c;
        if (or < 0 || oc < 0 || or + p.h > R || oc + p.w > C) continue;
        let ok = true;
        for (const { r, c, ch } of cellsOf(p)) {
          if (occ[or + r][oc + c] !== null) { ok = false; break; }
          if (known(or + r, oc + c) && board.solution[or + r][oc + c] !== ch) { ok = false; break; }
        }
        if (ok) { fits = true; break; }
      }
      if (fits) choices++;
    }
    steps.push({ choices, at: [tr, tc] });

    // Then place the piece that genuinely belongs there and move on.
    let truth = null;
    for (const p of hand.values()) {
      const [hr, hc] = p.home;
      if (cellsOf(p).some(({ r, c }) => hr + r === tr && hc + c === tc)) { truth = p; break; }
    }
    if (!truth) break;
    put(truth);
  }
  return steps;
};
