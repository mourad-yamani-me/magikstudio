---
title: The opening layout is part of the puzzle
date: 2026-09-01
order: 5
description: Where the loose pieces sit is a packing problem, and its objective is how large the board can be drawn. Optimise that and you leak the answer.
tags: [gamedev, puzzle, level-design]
devto: true
linkedin: false
draft: false
---

*Part 5 of 10 on building a word-block puzzle engine. [Part 4: difficulty rates, progression places.](/blog/difficulty-rates-progression-places/)*

A level opens with an empty grid and a scatter of loose blocks around it. I assumed this was
presentation — put the pieces somewhere sensible, get on with the game.

It is not presentation. It decides how big the grid is drawn, and it can give away the answer.
Both of those took a rewrite to learn.

## The objective is grid size, not fit

The camera frames the board and the loose blocks together, so the zoom is:

```
scale = min(availW / spanW, availH / spanH)
```

where the span is the bounding box of the board **and** every block, in cells. The board is then
drawn at `cols × scale`.

Every wasted cell of span comes straight off the size of the grid the player is reading letters
from. On a phone that is the difference between comfortable and squinting.

So this is not "does the arrangement fit on screen". It is a packing problem whose objective is
*how large can the grid be drawn*, and a loose arrangement that fits perfectly well can cost 20%
of the board.

The measure I report is **kept**: the drawn board size as a fraction of what it would be drawn at
with no loose blocks at all. Raw scale is not comparable between a 3×3 and a 17×10; kept is.

## The rule that makes it hard

Here is the trap, and it is a good one.

A cut board is tiled exactly by its own blocks. So the tightest possible way to pack those blocks
is to **rebuild the tiling** — and a packer whose objective is the smallest bounding box will
find that on its own, because it is genuinely optimal.

It is also the one arrangement the game cannot use. The blocks come out already assembled and
the level is reduced to sliding a finished slab onto the grid.

The near-misses are just as bad and much easier to ship by accident: two neighbouring blocks
sitting at the offset their solved positions have. The player sees `af` and `fo` already
interlocked and has been handed a piece of the answer for free.

The rule that catches all of it turned out to be one line of algebra. A block's implied board
origin is:

```
origin = seat − home
```

Two blocks that share an origin are sitting in their solved relationship. So: **no two blocks
that are neighbours in the solution may share an origin.**

Blocks that are not neighbours are left alone deliberately — at their home offset they do not
touch, so there is nothing there for a player to read. Being stricter costs span for no gain.

That rule is enforced at every seat inside the solver, again in the runtime fallback that deals
a layout when a board has none stored, and a third time as a check in the test harness. Three
places, because it is the constraint whose violation is invisible in a screenshot and obvious the
moment a player notices it.

## Clearance, and the corner exception

A loose block touching the board reads as one already placed. So there is a clearance gap —
`AIR = 0.28` cells — between the board and anything loose.

But only on the axes that matter, not diagonally. A block sitting off one of the board's corners
overlaps it on neither axis and touches it at a single point, which no player reads as placed.

Forbidding those four corner cells is expensive out of all proportion: it costs a whole column of
margin on every side, and with it any arrangement that wraps the board on all four sides is often
impossible at a size worth having. The tightest arrangements are built by tucking a block
diagonally past a corner, which is precisely what the naive rule bans.

## Cells, not pixels — and the half-row bug

Positions are stored as `(row, col)` in **cells**, relative to the board origin. Not pixels. That
is what makes an arrangement solved once offline reusable on any screen, any cell size, any zoom.

Fractional offsets are allowed and useful, which is where it gets subtle.

Packing happens in whole cells, then each block is slid back toward the board to close most of
the ring of air that packing needed. So a block can end up off the lattice on an axis where it
stands clear of the board — that offset *is* the closed gap, and it is what buys the span back.

But on an axis where it shares the board's extent it has to stay whole. A block in a side strip
sitting half a row out has its letters out of line with the rows it is about to join, and it
looks broken. The solver enforces that while sliding, and the harness checks it independently.

## Blocks on all four sides

Wherever an arrangement exists that puts something above, below, left and right of the board,
that is what ships.

This is a rule rather than a preference, and it costs real span. An arrangement that stacks
everything below the board is almost always tighter. It also looks like a bug in the camera — the
board floats at the top of the screen with a heap underneath, and the player's first read is that
something failed to load.

Symmetry buys more than it costs even when the arithmetic says otherwise. That is not a
statement I can defend with a number, which is why it is written down as a rule with the reason
attached, instead of being a constant somebody later "optimises".

## What "good" means, measurably

The harness reports four things per board, and the pipeline refuses to ship a pack that fails
any of them:

- **kept** — drawn board size as a share of the unobstructed maximum
- **fill density** — `blockCells / (spanW × spanH − boardCells)`
- **cells per side** — above / below / left / right, balanced, with the two side strips equal
- **overlapping cell pairs** — must be zero

Bounding boxes may and should overlap; interlocking silhouettes is the whole point. Only *filled
cells* may not.

## Why solve it offline

Layout solving is the slow step of the pack pipeline by a wide margin — it is a packing search
per board, with constraints, over 392 boards. Done at runtime it would be a visible pause on
every level open, on the slowest device you support, for an answer that is identical every time.

So the arrangement is computed once, stored in the board file, and read at level load. The
runtime keeps a fallback dealer for boards that have no stored layout, and that fallback enforces
the same scramble rule — because the day someone ships a pack without running the layout step,
the failure should be a slightly loose arrangement, not a level that opens pre-solved.

## The general lesson

I would not have guessed that where the pieces sit was a design surface at all. It looked like
the last 2% of polish, and it turned out to contain a real optimisation problem, a
solution-leaking bug class, and a constraint that had to be re-implemented three times to be
trustworthy.

The tell, in hindsight: it was the only part of the level that the level data did not describe. Everything
the board *is* was in the file; where it *starts* was being decided by whatever code happened to
run first. Anything in that category is worth a second look.

---

**Next:** part 6, [shipping a 4 MB level pack](/blog/shipping-a-4mb-level-pack/) — what all this data costs in the download, and how to stop paying for the parts nobody reads.
