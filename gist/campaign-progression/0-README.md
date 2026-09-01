# Ordering a campaign without sorting it

> **Full write-up:** [Difficulty rates a stage, progression places it](https://www.indiecore.net/blog/difficulty-rates-progression-places/)

Sorting a level library easiest-to-hardest produces a campaign that is flat for a hundred levels
and then a wall. On one 392-board library it put all 92 Easy boards inside the first 138 stages,
with no Tricky board until stage 133.

The rule that replaced it:

> Difficulty **rates** a level. Progression **places** it.

The library is a pool. Each slot carries an ask — a target, a tone, constraints — and the best
remaining level is chosen for it on difficulty, role, ramp and variety together.

## The three that took a rewrite each

- **The target is a quantile of what is left, not the minimum.** Anchoring to the easiest unplayed
  level sounds equivalent. It is not: the pool is consumed roughly easiest-first, so the minimum
  creeps up one level at a time and the target creeps with it — a sort wearing a rhythm.
- **Tone windows are four different ranges, not one band.** A single symmetric band makes an easy
  level *ineligible* once the anchor climbs past it, so the whole easy tail is untouchable through
  the middle and has nowhere to go but the end.
- **Beat order matters as much as beat counts.** With a comfort beat before the milestone, the
  milestone has to climb out of a dip and the anti-oscillation cap holds it down: only four of
  eighteen were the hardest board anywhere near them.

## Worth knowing

- **`MODEL_VERSION` is a migration.** Level numbers are saved progress. Bumping it keeps a
  player's completed count and changes which levels those numbers mean.
- **Damping the rhythm for beginners is the wrong protection** — it flattens the opening into one
  long shallow run. Beginners need no *spikes*, which is one line, not a curve change.
- **Record how every slot was filled.** When no candidate fits, the builder loosens one constraint
  at a time and writes down which. That turns "why is level 214 a 3.1?" into reading one object.

---

Written up in full here: **[Difficulty rates a stage, progression places it](https://www.indiecore.net/blog/difficulty-rates-progression-places/)**

_A distilled snippet from a shipped engine — see the post for context._
