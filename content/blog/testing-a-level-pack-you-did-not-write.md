---
title: Testing a level pack you did not write
date: 2026-09-01
order: 7
description: Unit-testing the game does not tell you whether the 392 levels in this build are solvable. So the suite plays every one of them.
tags: [testing, gamedev, puzzle, architecture]
draft: false
---

*Part 7 of 10 on building a word-block puzzle engine. [Part 6: shipping a 4 MB level pack.](/blog/shipping-a-4mb-level-pack/)*

The failure mode of a bad content pack is not a crash. It is a level that cannot be solved,
discovered by a player, three weeks after release, in a review.

Your unit tests will not find it. They test the code, and the code is correct — it is faithfully
rendering an impossible board.

## The whole test file

Every game on the engine has exactly one:

```js
import { describeGameShell } from '@gamefactory/word-engine/testing'

describeGameShell(import.meta.url)
```

That is not a simplification for the article. That is the file.

The suites live in the engine, not in the game, because they check things that must be true of
*any* game built on it. A copy of the suite in each app is a copy that drifts, and the sibling
whose copy is stale is precisely the one that ships the broken pack.

It takes `import.meta.url` rather than a path so a game does not have to know how deep its own
test file sits. The day that changes, it changes in one place.

## Four things it checks

{{gist:pack-suite.js}}

**Every board can be walked to a solve.** The difficulty walk from part 3 is a solver: fill the
topmost-leftmost empty cell with any block in hand that fits, and continue. Running it to
completion on all 392 boards proves each one has at least one full tiling reachable by the
procedure the game itself uses for its power-ups. A board that dead-ends is a board that will
strand a player.

**Every opening arrangement is legible and not the answer.** No two filled cells overlap. Nothing
overlaps the board. The clearance gap holds. And the scramble rule from part 5 — no two blocks
that are neighbours in the solution may share an implied origin — is re-checked here, in a third
implementation, against the shipped data rather than against the solver's intent.

**`brand.json` is honest about the pack it points at.** The declaration says `stageCount: 392`.
The catalogue on disk says how many boards there actually are. If those disagree the build is
wrong in a way that is quiet: the leaderboard ceiling is `stageCount × 3`, so an inflated count
creates a score nobody can reach, and a deflated one truncates the campaign.

**The shell still holds nothing but identity.** The structural assertion from part 1. It fails if
a component, a store or a piece of game logic appears in an app directory, which is what stops
"just this once, for this game" from quietly becoming a second codebase.

## The check I value most

Separately from the suite, the economy simulator runs a `--test` mode that asserts something
narrow and load-bearing: **the walk implemented in the engine reproduces, board for board, the
metrics the generator shipped.**

Three numbers ride on every board — `forcedShare`, `averageChoices`, `hardestStep` — written by a
tool in another repo, by a different implementation, months ago. The runtime walk recomputes them
and they must match exactly, or the build fails.

That single assertion ties together things that would otherwise drift silently:

- the generator's model of difficulty
- the ratings the campaign order is built from
- the power-ups that use the walk to decide what to place or flag
- the coin rewards priced off the decision load (part 8)

If any one of those four drifts from the others, the game keeps working and starts lying. Prices
stop matching difficulty; a level rated 8.1 plays like a 4. Nothing throws. It is exactly the
category of bug that is undetectable without a cross-implementation check, and it is why I did
not let the runtime walk be an approximation of the offline one.

## Testing content is slow, and that is the point

Walking 392 boards is not a fast test. It is seconds, not milliseconds, and it reads a few
megabytes off disk.

I let it be slow rather than sampling. A sampled content check is a check that passes on the run
where it mattered — the interesting board is always the one you did not draw. If it ever gets
slow enough to be a problem, the fix is to run it on the pack-build and the release build rather
than on every save, not to look at fewer boards.

## Where the suite refuses to help

Two things it cannot tell you, worth being clear about because a green suite is persuasive.

**It cannot tell you a level is good.** Solvable, legible, correctly rated and fairly priced —
all machine-checkable. Whether the board is *satisfying* is not, and no amount of this replaces
playing them.

**It cannot check the one board it cannot enumerate.** From part 2, a single 13×13 has too many
tilings to prove the scoring rule against in reasonable time. It ships flagged. The suite walks
it to a solve like any other, which shows it is playable, and says nothing about whether some
other arrangement of its pieces scores higher. That is a known, written-down hole rather than an
assumption, which is the most I can do with it.

## The rule I would generalise

If your content comes from a generator — yours or anyone's — the tests that matter are the ones
that **re-derive the generator's claims from the shipped artifact**, not the ones that check your
rendering code.

Every genuine content bug I have had was of the form "the data says X and the data is wrong". A
test that mocks the data cannot see any of them.

---

**Next:** part 8, [pricing an economy off the difficulty model](/blog/pricing-an-economy-off-its-difficulty-model/) — what happens when reward is a flat rate and the levels are not.
