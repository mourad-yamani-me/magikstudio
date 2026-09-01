# Testing content you did not write

The failure mode of a bad content pack is not a crash. It is a level that cannot be solved,
found by a player, three weeks after release, in a review. Unit tests will not find it — they
test the code, and the code is faithfully rendering an impossible board.

Each game's whole test file:

```js
import { describeGameShell } from '@your-scope/engine/testing'

describeGameShell(import.meta.url)
```

The suites live in the **engine**, not the game. A copy per app is a copy that drifts, and the
sibling whose copy is stale is the one that ships the broken pack.

## What it checks

| Suite | Catches |
| --- | --- |
| board walk | a level that dead-ends, and shipped metrics that no longer match |
| opening layout | overlapping pieces, and an arrangement that leaks the answer |
| pack declaration | a stage count that disagrees with the catalogue on disk |
| shell | game logic appearing in an app directory |

## The assertion worth stealing

Re-derive the generator's own claims from the shipped artifact. Three numbers ride on every
level here, written months earlier by a different implementation in another repo; the runtime
recomputes them and they must match exactly.

That one check ties together the difficulty model, the campaign order built from it, the
power-ups that use it and the prices derived from it. If any drifts, the game keeps working and
starts **lying** — and nothing throws.

Every genuine content bug is of the form "the data says X and the data is wrong". A test that
mocks the data cannot see any of them.

## Do not sample it

Walking every level is seconds, not milliseconds. Sample it and you have a check that passes on
the run where it mattered: the interesting board is always the one you did not draw. If it gets
too slow, move it to the pack build and the release build — not to fewer levels.

---

Written up in full here: **https://www.indiecore.net/blog/testing-a-level-pack-you-did-not-write/**

_A distilled snippet from a shipped engine — see the post for context._
