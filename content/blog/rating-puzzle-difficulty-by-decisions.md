---
title: Rating puzzle difficulty by decisions
date: 2026-09-01
order: 3
description: Grid size is the obvious difficulty proxy and it is wrong. Measuring the branching factor of the solve gives a rating that survives contact with players.
tags: [gamedev, difficulty, puzzle, procedural-generation]
code: https://gist.github.com/IndieCoreDev/02835f475522e68083df2567f1a562b5
codeLabel: The walk and the tiers, ready to adapt
devto: true
draft: false
---

*Part 3 of 10 on building a word-block puzzle engine. [Part 2: generate levels offline.](/blog/generate-levels-offline-not-at-runtime/)*

Every puzzle game has to answer "how hard is this level" before a player ever plays it, and the
proxies within easy reach are all bad. Grid size is bad. Piece count is bad. Number of words is
worse than either. I shipped a first pass ordered by grid size and it produced a curve that
went sideways for eighty levels and then fell off a cliff.

The rating I use now measures the one thing that actually varies: how much the player has to
work out.

## The insight that made it measurable

The player never sees the answer. The blocks carry letters, but they cannot be matched against
anything — there is no ghost image of the finished board. So the board is a **fitting problem**,
and its difficulty is how often the fit is forced and how often it is a guess.

That suggests a procedure, and the procedure is what a person actually does with a jigsaw:

> Fill the topmost-leftmost empty square. Count how many blocks still in hand could go there.

One means the board placed the block for you and cost you nothing. Five means a real decision,
and a wrong answer that will have to be undone later.

{{gist:walk.js}}

Walk the whole board that way and you get a list of branching factors, one per step. Everything
else is arithmetic on that list.

```
board       pieces   forced steps   average choice   worst step
8x8             13            38%              3.5            11
10x10           17            35%              3.9            12
17x10           25            32%              5.6            18
```

Three numbers ship on every board — plus a fourth the economy needs, which is the same list
summed:

{{gist:summarise.js}}

## Why the walk had to be exact

It would be tempting to approximate — sample a few steps, or estimate from piece shapes. I did
not, for a reason that only became obvious later: **the same walk runs on the device**.

Two power-ups need it. One places a block for the player, which means choosing *which* block
placement helps most; the other flags a block that is currently wrong. Both are the walk with a
different question asked of it. And the economy (part 8) prices a level off the total decision
load, which is the same list summed.

So the walk exists three times — in the offline rater, in an independent verifier, and in the
engine at runtime — and a test asserts that the runtime one reproduces the numbers the rater
shipped, board for board, or the build fails. Approximation would have made that impossible to
check.

The cost on device is nothing to worry about: at most 30 blocks per board, so a walk is a few
thousand cell tests, and choosing the best anchor is thirty of those. Well under a frame, and
it only runs when someone taps a power-up.

## One number hides too much

`overall: 7.2` tells a player nothing, and it told me nothing either — two boards rating the
same felt completely different to play. So the rating carries four dimensions, each a percentile
within the library, on one 0–10 scale:

| dimension | what it measures | weight |
| --- | --- | --: |
| `deduction` | how often a genuine choice has to be made | 0.35 |
| `peak` | the worst single decision on the board | 0.25 |
| `scale` | how much there is to place at all | 0.25 |
| `sameness` | blocks sharing an outline, which the eye cannot separate | 0.15 |

`sameness` is the one I would not have thought of from first principles. A board where six
blocks are the same silhouette is harder in a way none of the other three catch, because the
difficulty is not deduction — it is that you cannot *see* the difference and have to try them.

What is deliberately **not** in the list matters as much. The reference model this follows has
dimensions for precision, reaction, memory, time pressure and randomness. This game has no
timer, no dexterity and no luck, so those are left out rather than filled with zeroes. A
dimension that is always 0 is a column of noise that dilutes every weight next to it.

## Ratings must overlap across sizes

Here is the test that told me the model worked. If difficulty were really about size, ratings
would form disjoint bands: all the 8×8s below all the 10×10s below all the 13×13s.

They do not. Across the library ratings run 0.6 to 9.3, and a 10×10 spans **4.0 to 7.7** — it
meets the 8×8s below it and the 13×13s above it. There are 10×10 boards harder than most 13×13s,
which matches how they play and is invisible to any size-based proxy.

That overlap is also what makes a smooth campaign possible at all. If every size were its own
band you could only ramp difficulty by ramping size, and the player would watch the board grow
rather than the puzzle deepen.

## Turning a number into something a player can read

Nobody reads "6.4 / 10, deduction 9.2" and knows what they are in for. So there is exactly one
module that turns the model into player-facing language, and every difficulty surface in the
game — the level grid, the briefing card, the in-game banner — reads from it. Three surfaces
computing their own tiers is three surfaces that eventually disagree.

The tier boundaries are the pack's own quartiles, not invented round numbers:

{{gist:tiers.js}}

p25, p50, p75, p90. That splits 392 boards **23 / 25 / 24 / 15 / 12 percent** across five tiers,
which keeps the top tier rare enough that seeing one means something. Round numbers would have
put 60% of the library in one tier.

Those constants are pack-specific and there is a report script that prints the current split, because
rebuilding the pack moves the quartiles and nothing else will tell you.

The words themselves are not in that module — a tier carries a key and the caller looks it up in
the string catalogue. That split is what lets the model ship in seventeen languages without
seventeen copies of the quartiles in them.

## The rating is a prior, not a truth

The most important line in the model is the one that admits what it does not know. Every board
ships with:

```json
"confidence": 0.2,
"sampleCount": 0
```

There are no players yet. The rating is a measurement of the *board*, which is not the same
thing as a measurement of the *difficulty a person experiences*, and pretending otherwise is how
you end up defending a number against your own players.

The seam for fixing that is deliberately left open: when telemetry arrives, blend toward
observed difficulty and raise confidence with the sample count, with a rate limit so a handful
of unusual players cannot move a rating far. None of that is built. But `confidence` is in the
data and every consumer reads it, so the day it changes nothing downstream has to be rewritten.

## What I would tell someone starting this

Find the thing the player is actually doing, and count it. Not the thing you can measure easily
— the thing that is hard. For this game it was branching factor; for a match-3 it might be the
number of boards reachable in one move; for a platformer, the length of the longest sequence
with no checkpoint.

And write the second implementation. The verifier that re-derives the ratings independently has
paid for itself twice, and both times the bug was a shared assumption that a unit test of the
first implementation was structurally incapable of finding.

---

**Next:** part 4, [difficulty rates a stage, progression places it](/blog/difficulty-rates-progression-places/) — why sorting your levels by difficulty produces a terrible campaign.
