---
title: Pricing an economy off its difficulty model
date: 2026-09-01
order: 8
description: Levels differ 13x in the thinking they demand, so a flat coin reward is wrong on nearly all of them. Tying payouts to the difficulty walk.
tags: [gamedev, game-economy, free-to-play, difficulty]
code: https://gist.github.com/IndieCoreDev/8f228b50bc004fc45e826368d0d1da22
codeLabel: The economy module the simulator shares
draft: false
---

*Part 8 of 10 on building a word-block puzzle engine. [Part 7: testing a level pack you did not write.](/blog/testing-a-level-pack-you-did-not-write/)*

The first economy paid 20 coins for finishing a level. Every level. It survived about a week of
my own play before it was obviously broken, and the reason is a number from part 3.

A level's **decision load** — the total count of real choices the board forces across a full
solve — runs from **7.5 on the easiest tier to 96.7 on the hardest**. A 13× spread. A flat rate
pays the same for a two-minute board and a twenty-minute one, which teaches the player to grind
the easy end of whatever is unlocked and never touch the interesting boards.

## Reward follows the thinking, not the rating

The payout is tied to decision load rather than the 0–10 difficulty rating, and that distinction
is deliberate. The rating is a percentile — a comparison against other boards. The decision load
is an absolute count of work done. Coins should pay for work.

{{gist:economy.js}}

Eight coins on an Easy board, 35 on an Expert one. The floor exists so a tiny 3×3 still feels
like it paid something; the slope is what makes a hard board worth choosing.

## The module knows nothing about the game

Everything the game charges, pays or caps is in one file, and nothing in that file touches React,
the store, or storage. It is data and pure functions.

That is not tidiness. It is what lets the **simulator import the same module**. A balance
simulator that re-implements the economy is a simulator that tells you about a game you are not
shipping — and it will diverge on the first tuning pass, silently, because nothing connects them.

Sharing the module means a number tuned in one place cannot drift from the other, and the balance
the simulator reports is the balance that ships.

## What the simulation actually found

I would not have found either of these by playing.

**Star bonuses were 45% of all income.** The single largest faucet in the game — larger than
level completion, larger than ads, larger than the daily chest. And three stars is earned on
about two thirds of levels, which makes a generous star bonus a tax-free salary rather than a
reward for excellence.

They came down hard, and `STAR_BONUS` above pays them as a **delta** against the highest tier
ever banked for that level. Replaying a 3-star level pays nothing. Dragging a 1-star up to 3 pays the difference, once, ever.
Without the delta, replaying your easiest completed level is the optimal way to earn, which is
both a broken economy and a boring game.

**The daily chest escalated without limit.** It grows a little each time the seven-day cycle
completes, which is a nice feeling for the first fortnight. Left unbounded, by the eighth cycle
the day-7 chest paid **225 coins** — more than three level clears — for opening the app.
`CHEST_MAX_CYCLES` is the whole fix. Retention rewards should be worth showing up for and never worth more
than playing.

## The price floor is set by the largest single payout

A subtle constraint I got wrong first. The most any single purchase can unlock is bounded by the
biggest reward it can lead to — here, the top star delta. If a hint costs less than that, the
optimal strategy is to buy hints until three stars is guaranteed, on every level, forever. The
economy becomes a vending machine.

So the top star delta sets a floor under every price, and the floor is written down next to the
constant that produces it. The relationship between two numbers in different sections of a file
is exactly the thing that gets broken by someone reasonably tuning one of them.

## Ads pay a multiplier, not a currency

Rewarded video doubles a first clear and never appears on a replay.

Tying the ad reward to the level rather than to a fixed coin amount means it inherits the
difficulty scaling for free — doubling a 35-coin Expert clear is worth watching, doubling an
8-coin Easy one is not, and the player self-selects. A flat "watch for 25 coins" would have
inverted that: farm the easiest level, watch the ad, repeat.

There is no interstitial between levels. That was a product decision rather than an economic one
and I do not have data to defend it; what I can say is that it removed an entire class of tuning
problem, because there was no longer a knob whose optimum is "as often as players tolerate".

## Invariants, not just numbers

The simulator has a `--test` mode that asserts properties rather than printing a report:

- No sequence of legitimate actions produces unbounded coins.
- Every purchasable item is reachable within a bounded number of levels from zero.
- Replaying a completed level never nets positive.
- The difficulty walk the prices are computed from still matches the metrics shipped on every
  board (part 7).

The last one is the join between this post and the rest of the series. Prices are derived from
the same walk that rates the levels and drives the power-ups. If that walk drifts, the game keeps
running and every price silently becomes wrong. A test that says so is worth more than a
spreadsheet.

## What I still do not know

Whether any of it is right. Every number here is defended against a simulation, and a simulation
is a model of a player I invented.

The honest position is that this is a *starting* balance whose main property is being internally
consistent and cheap to change — one file, no game code, a simulator that shares it. When real
telemetry arrives, most of these constants will move. The structure is built so that moving them
is a one-line change with a test run behind it, rather than an archaeology expedition through the
UI code.

---

**Next:** part 9, [cutting a Capacitor Android build in half](/blog/capacitor-android-build-apk-size/) — where the download actually goes, and the consumer ProGuard rule that cost 9,304 classes.
