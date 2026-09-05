---
title: Rankgrip: an open Google Play keyword metric
description: An open metric scoring how tightly a Google Play keyword is already held, 0 to 100. Who made it and why, the full formula, and why there is no search volume column.
date: 2026-09-04
---

**Rankgrip is a 0–100 score for how tightly a Google Play keyword is already
held.** Zero is an open field. One hundred is a door that will not move whatever
you write in your listing.

It exists because app store optimization has a step most keyword research leaves
out. Finding phrases people search on the Play Store is the easy half; working
out which of them you could realistically take is the half that decides where a
week of work goes.

It runs in the direction of difficulty, like the keyword-difficulty scores you
already know from web SEO, and for the same reason. "How big is this term" is
the question every tool answers. "Can I have it" is the one that decides your
week.

**Rankgrip is open.** Every report on this site scores every keyword with it, and
this page is the whole definition — the four factors, their weights, the band
cuts and the arithmetic. Nothing is held back and no part of it is proprietary.
That is deliberate, and it is the main thing separating Rankgrip from the scores
it resembles: Domain Authority, Domain Rating and Trust Flow are all numbers you
are asked to trust without being shown how they are made. A score you cannot
check is a score you should not trust, including this one.

## The three bands

| Rankgrip | Band | What it means |
| --- | --- | --- |
| 0–29 | **Open** | Nothing structural is in the way. A good listing can take this. |
| 30–69 | **Tight** | A real fight, and one a better listing can still win. |
| 70–100 | **Held** | No rewrite moves this. Spend the week elsewhere. |

In the August 2026 puzzle report those bands fall exactly where the evidence
does: the sixty-one open terms score between 5 and 41, and the eight wall terms
between 47 and 80. The two groups were selected by different rules and they do
not overlap, which is the closest thing to a check this method has.

## The four factors

Rankgrip is a weighted sum of four separate ways a keyword can be held. Each is
counted from observed Play rankings, not estimated.

| Factor | Weight | What it counts |
| --- | --- | --- |
| **Slot share** | 40% | How many of the top ten belong to a developer big enough that outranking them is not a listing problem. |
| **Title lock** | 25% | How many apps put the phrase in their app name, capped at three. |
| **Maturity** | 20% | How many of the leaders are established, as against recently arrived. |
| **Tenure** | 15% | How long the current number one has held the top slot, capped at five years. |

**Slot share carries the most weight because it is the barrier nothing you write
can touch.** You do not out-rank a studio with a user-acquisition budget by
writing better copy. Title lock is second because it is the strongest on-page
signal in Play search and the one an incumbent cannot accidentally give up.
Tenure is last, and lightest, because it is the most reversible: a long tenure is
evidence of a strong position, never the cause of one.

### Why the factors are added, not multiplied

Because barriers stack; they do not gate. A term can be taken from a big
developer who never put the phrase in their title; it can be taken from a title
match whose app is three months old and small. What cannot be taken is a term
where all four are true at once.

A weighted sum says exactly that. Multiplying would say something false — that a
single zero makes a keyword free — and the rankings do not support it.

## Why there is no search volume column

This is the first thing people look for, and it is missing on purpose.

Google publishes no search volume for Play. No tool has it. Every number sold as
"Play search volume" is inferred — from Google Ads data for *web* search, from
autocomplete ordering, from a panel of installs — then scaled by a constant
somebody chose. Those are estimates of a different thing. Call them
unfalsifiable rather than wrong: nobody outside Google can check them, the
vendors selling them included.

The second problem is the one Rankgrip exists to solve. Even a perfect volume
number does not tell you whether to write the keyword into your listing. The
highest-demand puzzle term measured in August was `puzzles`, and ten out of ten
of its results belong to developers a small studio will not outrank this decade.
Volume says chase it. Rankgrip says 75, held. Ranking a report by volume would
put that term at the top of the page and be actively harmful.

Demand still appears beside Rankgrip, as a 0–100 score that ranks terms against
each other within one report. It is never presented as searches per month,
because it is not.

## Every filter a keyword passes first

Rankgrip scores a term only after it has survived the gate. In order:

1. **It ranks apps in the category.** A Play keyword carries no category of its
   own, so it borrows the categories of the apps holding its top ten.
2. **Play's own autocomplete offers it.** The demand gate, and the most important
   filter here. Without it the list fills with stock phrasing lifted from app
   listings — "their respective owners" scores well structurally and no human has
   ever typed it into a search box.
3. **Every word is vocabulary, not a brand.** Each word must appear in at least
   fifty different app names. A word one studio uses is a product name; a word
   thousands use is the market's language. This separates `block fill puzzle
   offline` from `arrowscapes no ads`.
4. **It is at least two words.** Single words on Play belong to whoever bought
   them years ago.
5. **It matches no app or developer name**, exactly.
6. **Rewordings collapse.** `ai girlfriend puzzle game` and `ai girlfriend game
   puzzle` are one row, not two.
7. **A person reads what is left.** Roughly a third of what survives every filter
   above is still a phrase no studio should chase — a passing meme, a
   mistranslation, something off-theme. Those are struck off by hand, with the
   reason recorded, so next month makes the same call.

That last step is no weakness in the method. It is an honest description of what
an automated gate can and cannot know — and any score claiming it needs no such
step is either not looking at its own output, or not showing you all of it.

## Where the numbers come from

Every number in a report is a measurement of the live Google Play store in the
country and language that report names, taken daily. Nothing is modelled from a
third-party panel, estimated from web search data, or bought from a data vendor
— which is the whole reason the reports can say who holds a slot and for how
long, in place of guessing how many people search for it.

The limits, stated plainly instead of buried: the measurement window is young,
so month-over-month movement only becomes trustworthy with two full months to
compare. Coverage is deepest in US English. A keyword whose competitors have not
been measured is marked unmeasured, never scored as open — an absent number is
not a good one.

## Who made this, and why

Rankgrip was created by **Othmane Ettaib** and first published in September 2026
by **Indie Core Dev**, a one-person game studio in France that ships free puzzle
games on Google Play.

It exists because of a specific and repeated mistake. Choosing keywords from
volume-based tools, the same thing kept happening: a term would look excellent —
high estimated volume, low competition score — and the listing built around it
would go nowhere. Looking at who was actually ranking for those terms explained
it every time. The slots were held by studios with a hundred million installs, or
by apps carrying the exact phrase in their title, and no amount of description
copy was going to move them. The tools were answering "how many people search
this", which is a real question, and treating it as if it were "can you have
it", which is a different one.

So the studio started measuring Play rankings daily — who holds which slot, for
how long, at what scale — and Rankgrip is that data reduced to the one number
that decides the answer. No market forecast, no traffic estimate: it measures
how firmly a term is already occupied, which is the part the existing tools
leave you to guess at.

The reports on this site are the studio's own keyword research, published rather
than kept. There is no product being sold here and no free tier to upgrade from,
which is worth saying plainly: it means the incentive to make the numbers
flattering does not exist.

## Using and citing Rankgrip

Rankgrip is free to use and free to cite. Quote a score, name the report it came
from, and link this page so a reader can check the definition:

> `game lucky arrows` has a Rankgrip of 5 (Indie Core Dev, *Google Play
> keywords: puzzle games, August 2026*).

The formula is published, so anyone is welcome to implement it. **Rankgrip** is
the name Indie Core Dev uses for this metric — if you compute something
different, please call it something different, so a reader who compares two
numbers is comparing the same thing.

If you disagree with a weight, the argument is above and the code is in the open.
That is the whole point of publishing the method, and not just the brand.
