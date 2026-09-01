# Rating a puzzle by the decisions it forces

> **Full write-up:** [Rating puzzle difficulty by decisions](https://www.indiecore.net/blog/rating-puzzle-difficulty-by-decisions/)

Grid size is the obvious difficulty proxy and it is wrong. This measures the branching factor
of the solve instead.

```
fill the topmost-leftmost empty cell
count how many pieces still in hand could go there
```

One means the board placed the piece for you. Five means a real decision, and a wrong answer
that will have to be undone.

## Files

| File | What it is |
| --- | --- |
| `walk.js` | The walk, and the four numbers derived from it |
| `tiers.js` | Turning a 0-10 rating into a tier a player can read |

## Worth knowing

- **The walk has to be exact, because it runs three times.** Offline in the rater, again in an
  independent verifier, and again on the device — two power-ups are this walk with a different
  question asked of it, and the economy is priced off its `decisions` total. A test asserts all
  three agree, board for board, or the build fails. Approximation makes that impossible to check.
- **Tier boundaries are the pack's own quartiles**, not round numbers. p25/p50/p75/p90 split one
  392-board library 23/25/24/15/12 percent. Round numbers put 60% of it in one tier.
- **Ratings must overlap across board sizes.** If they form disjoint bands by size, the model is
  measuring size. A 10x10 here spans 4.0 to 7.7 and meets both the 8x8s below and the 13x13s above.
- **Leave out dimensions you do not have.** No timer, no dexterity, no luck — so no precision,
  reaction or randomness axes. A dimension that is always 0 dilutes every weight next to it.
- **The rating is a prior.** `confidence: 0.2`, `sampleCount: 0`. It measures the board, not the
  difficulty a person experiences, and the code says so rather than pretending.

---

Written up in full here: **[Rating puzzle difficulty by decisions](https://www.indiecore.net/blog/rating-puzzle-difficulty-by-decisions/)**

_A distilled snippet from a shipped engine — see the post for context._
