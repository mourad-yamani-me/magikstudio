---
title: Generate levels offline, not at runtime
date: 2026-09-01
order: 2
description: Runtime generation promises infinite levels for free. What it gives you is levels nobody has checked. The offline pipeline I use instead.
tags: [gamedev, procedural-generation, puzzle, architecture]
draft: false
---

*Part 2 of 10 on building a word-block puzzle engine. [Part 1: one engine, many games.](/blog/one-engine-many-games/)*

The pitch for runtime generation is irresistible when you are one person: seed a PRNG, generate
a board on demand, ship infinite levels in a hundred lines. No content pipeline, no 4 MB of
JSON in the app, no "we ran out of levels" problem.

I built the generator to run offline instead, into a folder of files that ship with the app.
This is the argument for that, and the thing runtime generation cannot do.

## The guarantee

The game hands you a completed word grid carved into connected blocks of letters. You drop the
blocks back onto an empty board. Blocks are never rotated or mirrored — they go back in the
shape they came out.

```
┌───────────────┬───────┬───────┐        loose:
│ a   f   f   o │ r   d │ e   d │
├───┐       ┌───┘   ┌───┤       │          a f f o      e d
│ u │ r   i │ n   e │ r │ u   e │          u            u e
│   ├───────┤       │   └───┐   │                         b
│ d │ i   v │ e   v │ e   r │ b │
```

The blocks tile the board exactly, so *any* complete placement fills it. Many boards can be
filled several ways. That is fine and even good — what must not happen is that some other
arrangement scores **more** words than the one the board was cut from, because then the game is
telling a player who solved it properly that they did worse.

So the rule the generator enforces is:

> No other way of fitting the pieces may score more words than the intended filling.

Ties are allowed. Being beaten is not.

Checking that means enumerating every way the pieces tile the board and scoring each one. On
one board in the library that is 626 distinct tilings. On another it is 1. You cannot do this
on a phone while the player waits, and you cannot skip it, because the failure it catches is
invisible until a player hits it.

## The rule I had to relax, and why

The first version was stricter: the pieces must fit together *one way only*. Unique tiling,
no ambiguity, provably the answer.

It worked and it was wrong. Forcing a unique tiling pushed piece sizes up to 5–10 letters on
almost every board — big slabs, which makes the puzzle a jigsaw of four obvious lumps — and on
a 3×3 the constraint cannot be satisfied at all. I lost the small boards entirely, which are
the ones a new player needs.

The scoring rule protects the same thing for far less. A player who assembles the board
differently still fills the grid; they just score fewer words. The current library:

| | |
|---|---|
| fit together exactly one way | 183 |
| fit several ways, intended still best | 208 |
| beaten by another filling | **0** |

208 boards would have been thrown away by the strict rule for a property no player can
perceive.

## What the pipeline actually does

Three tools, run over a folder, none of them shipped in the app:

```
cut-stages.mjs      carve grids into connected blocks, enforce the scoring rule
rate-stages.mjs     measure difficulty
verify-blocks.mjs   re-derive every claim without trusting the cutter
```

775 source grids went in. **392 boards** came out, in 66 shapes from 3×3 to 17×10, 5,449 blocks
between them.

The gap between 775 and 392 is most of the value. Boards get dropped for reasons you would only
discover in production otherwise:

- **Too tall to play.** Only boards up to two rows per column are cut. A 25×3 is 8.3 rows per
  column — a column of letters with nowhere on screen for the loose blocks to sit. That rule
  alone excludes 383 grids.
- **Fewer than four blocks.** A two-block board is placed with nothing to work out.
- **Unprovable.** One 13×13 has so many tilings that the check does not terminate in reasonable
  time. It ships flagged, and it is the only one.

Where a board has too many tilings to enumerate, the cutter climbs a piece-size ladder — 4–6
letters, then 5–7, 6–8, 7–10, 8–12 — because bigger pieces fit together fewer ways. Piece size
is therefore decided per board by what that board needs, not by a rule of thumb. That is a
second thing a runtime generator cannot do: it has no budget to try five parameterisations and
keep the one that proved out.

## The checker does not trust the generator

`verify-blocks.mjs` re-derives every claim from scratch: every cell covered exactly once, every
block connected, every block sitting where it says it sits, and — on a sample — the word counts
recomputed independently of the code that wrote them.

This is not belt and braces. The cutter and the checker were written against the same spec by
the same person on the same afternoon, and the checker has caught the cutter twice. Both times
it was a shared assumption that turned out to be wrong in one direction only, which is exactly
the class of bug a second implementation finds and a unit test of the first does not.

The current run reports all clear across 392 boards and 5,449 groups.

## Why a word is any run of three letters

A detail that changed the whole shape of the data. The board draws no word boundaries — the
player never sees where a word is meant to start or stop. So a word is **any run of three or
more letters in a row or a column**. A filled row reading `iondadyour` holds `ion`, `dad`,
`you`, `your` and `our`.

That has a consequence I did not anticipate: filtering the dictionary is pointless. Of 107,688
words in the source list, the number that **no** board in the library could ever show is 25. So
the game ships the dictionary as-is, packed one line per word length:

```
3=aahabaabbabcabyaceactadd…
4=…
```

877 KB, ten lines, read as a string rather than parsed into a hundred thousand objects at
startup. A word costs exactly its letters.

It also means a finished board is the *best*-scoring state, not a state you have to hunt for.
The 10×10 the grid was built from lists 54 words; the completed board shows 97.

## What runtime generation would actually have cost

Not the generator — that part is genuinely easy. The costs are all downstream:

**You cannot rate a board against a library you have not generated.** Difficulty here is a
percentile within the pack (part 3). A board generated on the player's phone has nothing to be
a percentile of.

**You cannot order a campaign you have not seen.** The progression builder (part 4) fills each
slot by picking the best remaining board from a pool. A pool that does not exist yet cannot be
searched.

**Progress becomes unportable.** Stage numbers are the player's saved progress. If stage 137 is
whatever the generator produces from seed 137, then changing one line of the generator silently
changes what every player has completed. With a shipped pack I can at least version the
ordering model and decide deliberately.

**Nobody has played the level.** This is the real one. A shipped board has been enumerated,
scored, rated, walked to a solve by a test (part 7) and packed into an arrangement that is
checked for legibility (part 5). A generated board has been through none of that at the moment
the player sees it.

## What it costs instead

Honesty demands the other column. The pack is 4.4 MB of JSON pretty-printed, 2.4 MB minified,
and it is the second-largest thing in the app after the Android runtime. Part 6 is entirely
about getting that down and loading it sensibly.

And the content is finite. 392 boards is maybe 25 hours of play, and when a player finishes
them there is nothing behind it. Runtime generation does not have that problem.

The trade I made: a finite pack every board of which I can defend, over an infinite one where
the first board a player cannot solve is a support email I cannot reproduce. For a puzzle game
where the whole product is the quality of the puzzles, that is not close.

---

**Next:** part 3, [rating puzzle difficulty by what the player actually decides](/blog/rating-puzzle-difficulty-by-decisions/) — why grid size is a bad proxy for hard, and what to measure instead.
