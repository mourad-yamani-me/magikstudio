---
title: Difficulty rates a stage, progression places it
date: 2026-09-01
order: 4
description: Sorting a level library easiest-to-hardest gives a campaign that is flat for a hundred stages and then a wall. What replaced the sort.
tags: [gamedev, difficulty, level-design, puzzle]
code: https://gist.github.com/IndieCoreDev/85b015318475143f35ee6df50fcf9d65
codeLabel: The envelope, the rhythm and the tone windows
devto: true
linkedin: false
draft: false
---

*Part 4 of 10 on building a word-block puzzle engine. [Part 3: rating difficulty by decisions.](/blog/rating-puzzle-difficulty-by-decisions/)*

Once every level has a difficulty rating, the campaign order looks solved. Sort ascending. Ship
it.

I shipped that. What it produced was a campaign where all 92 Easy boards landed inside the
first 138 stages and the first genuinely Tricky board did not appear until stage 133. A hundred
levels of nothing happening, and then a wall.

The rule I ended up with, and the one thing worth taking from this post if you take nothing
else:

> Difficulty **rates** a stage. Progression **places** it. They are not the same job and the
> rating must not decide the position.

## What a sort actually does wrong

Three things, and only the first is obvious.

**No relief.** After a hard board, a sort gives you a slightly harder one. There is nowhere for
the player to catch their breath, so the difficulty curve is monotone and exhausting in exactly
the way real level designers never make it.

**Similar boards cluster.** Similar boards *sort* together — same size, same piece count, same
branching profile — so you get a run of eleven near-identical puzzles and the player learns
nothing new for twenty minutes.

**The easy tail piles up at the end.** This is the one that catches you. Selection is never
purely by rank, so the pool drifts, and any board that keeps losing has to still be asked for
later. With a sort, the leftovers are all easy, and they are all at the end.

## The pool, the slot, and the ask

The replacement is not a sort. It is a fill.

The library is a **pool**. Each slot in the campaign carries an **ask** — a target difficulty, a
tone, and a set of constraints. The builder picks the best remaining board for that slot on
difficulty, role, mechanic ramp and variety **together**, removes it from the pool, and moves on.

The target for a slot is a **quantile of the boards still unplayed**, following a designed curve
across the campaign:

{{gist:envelope.js}}

A quantile, not a minimum, and this distinction cost me an afternoon. Anchoring to the easiest
board still in the pool sounds equivalent. It is not: the pool is consumed roughly easiest-first,
so the minimum creeps up one board at a time and the target creeps with it. That is a sort
wearing a rhythm, and it reproduces exactly the failure above.

A quantile sits *above* the easy tail rather than on it. The tail then gets picked up later by
the dips in the wave and by recovery beats, which is where an easy board actually belongs — as a
breather two hundred stages in, not as stage 40.

## The rhythm is a twenty-beat cycle

Every slot has a tone. The cycle:

{{gist:beats.js}}

12 comfort, 5 challenge, 2 recovery, 1 milestone — 60 / 25 / 10 / 5.

**The order matters as much as the counts.** Beat 11 is a challenge and beat 12 is the
milestone, because the shape you want is escalation *into* the major challenge. My first version
had a comfort beat in slot 11, so the milestone had to climb out of a dip, the anti-oscillation
cap held it down, and only **four of eighteen** milestones ended up being the hardest board
anywhere near them. A milestone that is easier than the level before it is not a milestone, it
is a lie with a badge on it.

## Tone windows, and the mistake that stacks easy boards

Each tone has a window expressed relative to the anchor:

{{gist:tones.js}}

Four different ranges, not one band around one number. I had one symmetric band first, and it is
the direct cause of the piled-up easy tail: a symmetric band makes an easy board **ineligible**
the moment the anchor climbs past it. The whole easy end of the library becomes untouchable
through the middle of the campaign and then has nowhere to go but the end.

Comfort and recovery reaching properly *below* the anchor is what keeps draining it.

`loEnd` is the other half. Comfort has to reach a long way down early, because that is the
drainage — but the same reach at stage 325 drops a Steady board into the late campaign, which
reads as a bug rather than a breather. So the downward reach tapers: early it is drainage, late
there is nothing down there worth showing and it closes.

## Speed limits, asymmetric on purpose

`STEP` above — 2.2 up, 3.4 down — is how far difficulty may move between consecutive stages, and
it is what stops the 8.0 → 3.0 → 8.0 oscillation a naive rhythm produces.

Asymmetric deliberately: dropping into a recovery stage should be *allowed* to feel like a drop,
while a jump upward has to be earned by the rhythm rather than arriving because the pool happened
to be thin.

## Damping the beginner curve was the wrong protection

The instinct is to flatten the rhythm for new players and open it up over time. I did that, and
it turned the first hundred stages into one long shallow run — the exact thing I was trying to
escape.

What beginners need is not a flat curve, it is **no spikes**. So the wave barely opens up at all
(`1.0 → 1.15`), and the protection is a single line instead: a milestone slot before stage 16 is
treated as a comfort slot. Six calibration stages at the front are strictly increasing, small,
and low on deduction, so nothing surprises anyone in the first five minutes.

## Every slot records how it was filled

The part I would build first next time. When a slot cannot be filled — the band is too narrow,
every candidate violates an anti-repetition window — the builder climbs a **relax ladder**,
loosening one constraint at a time. Every step is recorded on the slot.

That turns "why is stage 214 a 3.1?" from an afternoon of print statements into reading one
object. It says which constraint was dropped and what the alternatives were. There is a report
script that prints the whole campaign's shape — the tone mix against target, the difficulty
trace, where the ladder was used — and it is the only reason the tuning above converged at all.

## The version number is a migration

`MODEL_VERSION`, at the top of the envelope above, is one line that is easy to miss and
expensive to get wrong.

Stage numbers are the player's saved progress. The order is deterministic and seeded, so
everyone gets the same campaign — but bumping this changes **which board each stage number refers
to**. A player who completed 137 stages still has 137 completed stages, and they now point at
different boards.

That is fine when the pack changes anyway. It is not fine as a casual tuning bump. Anything that
changes selection has to be a deliberate decision about existing players, and having the constant
sitting there with that comment on it is what makes it one.

## What is not built

The model this follows describes a runtime engine fed by telemetry: a player skill model,
short-term win/loss streaks, session shaping, difficulty updated from observed behaviour. None of
that exists here, and it cannot until there are players.

What is built is the offline half — the envelope, the rhythm, roles, the target distribution,
anti-repetition windows, seeded randomness, and the debugging record. The seams for the rest are
marked in the code: the function that computes a slot's target is where a skill target would be
blended in, and the scoring function is where a skill-dimension fit would be added.

Writing those two comments took a minute. Finding those two places again in six months would
have taken a day.

---

**Next:** part 5, [the opening layout is part of the puzzle](/blog/opening-layout-is-part-of-the-puzzle/) — where the loose pieces sit when a level opens, and why it is a packing problem with a surprising objective.
