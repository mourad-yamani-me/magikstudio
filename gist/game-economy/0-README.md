# An economy priced off the difficulty model

Levels in this game differ **13x** in the thinking they demand — a decision load of 7.5 on the
easiest tier against 96.7 on the hardest. A flat coin reward is therefore wrong on nearly all of
them, and it teaches players to grind the easy end and never touch the interesting levels.

```js
clearReward = round(6 + 0.30 * decisionLoad)   // 8 coins Easy, 35 Expert
```

## The structural decision

Nothing in this module touches the UI framework, the store, or storage. That is what lets the
**balance simulator import the same file**. A simulator that re-implements the economy describes
a game you are not shipping, and it diverges on the first tuning pass without telling you.

## What simulation found that play did not

- **Star bonuses were 45% of all income** — the largest faucet in the game, while three stars is
  earned on two thirds of levels. That is a salary, not a reward. They are now paid as a *delta*
  against the best tier ever banked, so replaying a completed level nets zero.
- **The daily chest escalated without limit.** By the eighth cycle its day-7 chest paid 225 coins
  — more than three level clears — for opening the app.
- **The largest single payout sets the price floor.** If a hint costs less than the top star
  delta, buying hints until three stars is guaranteed is optimal, forever, and the economy is a
  vending machine.

## Ads

Rewarded video is a **multiplier on the level**, never a flat coin amount, so it inherits the
difficulty scaling for free. Doubling a 35-coin clear is worth watching; doubling an 8-coin one
is not, and the player self-selects. A flat "watch for 25 coins" inverts that.

## Assert properties, not numbers

The simulator's `--test` mode checks that no legitimate action sequence produces unbounded
coins, that every item is reachable from zero, that replaying never nets positive, and that the
difficulty walk the prices derive from still matches the metrics shipped on every level.

---

Written up in full here: **https://www.indiecore.net/blog/pricing-an-economy-off-its-difficulty-model/**

_A distilled snippet from a shipped engine — see the post for context._
