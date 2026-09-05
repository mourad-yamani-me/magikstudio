# Winnable-keywords reports

A second content type, and not a blog post. An issue is mostly a table, it is
dated by the month it measures, and its numbers come out of a database this
repo cannot reach. `/aso/<slug>/`.

## Making one

```bash
npm run aso                                  # what to publish next, ranked by depth
npm run aso -- --harvest game_puzzle         # writes _source/aso/<slug>.json
cp content/aso/_template.md content/aso/<slug>.md
npm run check && npm run dev                 # http://localhost:4321/aso/<slug>/
npm run keywords -- --aso                    # do the pages carry the head phrases?
```

`--aso` reads `dist/`, so build first. A plain build only covers what is
published; `PREVIEW_SCHEDULED=1 npm run build` puts the held issues in `dist/`
too, which is how you check an issue before the day it ships.

The phrases it checks are in [`_source/aso/targets.json`](../../_source/aso/targets.json),
each marked with whether Google's autocomplete actually returns it. That file
also records the phrases that returned **nothing** — `google play keywords for
games`, `how to find keywords for google play`, `keyword difficulty play store`
and four more — so nobody spends an afternoon optimising for demand that is not
there. Re-check with:

```bash
curl -s "https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=<phrase>"
```

The harvest needs the ideaminer analytics stack running locally — it queries
`ideaminer-analytics-db` over `docker exec`, read-only. Override with
`ASO_DB_CONTAINER`, `ASO_DB_NAME`, `ASO_DB_USER`.

**Commit the JSON with the issue.** CI has no route to that database and never
will, so the build reads the committed snapshot and nothing else. A missing
snapshot fails the build and names the command that writes it.

## Frontmatter

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Keep the category in it. The month lives in the metadata, not the title. |
| `date` | yes | `YYYY-MM-DD`. Dated ahead holds the issue, exactly like a post. |
| `order` | no | A number. Orders issues sharing a `date`, ascending, so a run that goes out several on one day reads in the intended sequence. Without it the tie falls to the slug, which is alphabetical. |
| `description` | no, but do it | Shows on `/aso/` and in Google results. |
| `data` | no | The snapshot slug. Defaults to the issue's own filename. |
| `draft` | no | `true` keeps it off the site entirely. |

There is no `devto` or `linkedin` field, and there will not be one. **The
reports are site-only.** They are not cross-posted to dev.to, not announced on
LinkedIn, and not syndicated anywhere off this domain.

That is a decision, not a gap waiting to be filled. The whole value of the
series is that it is the one place these numbers exist — a canonical URL people
cite and link, with `/aso/rankgrip/` behind it. A copy on another platform
splits the citations between two addresses and hands the ranking to the one with
the bigger domain, which is never going to be this one. A post can afford that
trade because a post is an argument; a report cannot, because a report is a
reference.

The cross-posting scripts read `content/blog/` only, so this holds by itself
today. It holds by accident rather than by rule, which is why it is written
down here and in `AGENTS.md`, and why both scripts carry a comment at the line
someone would have to change.

## What the prose is for, and how much of it there has to be

**At least 500 words of analysis that is true of this issue and no other.**
That number is a floor, not a target, and it is the single most important rule
on this page.

Here is the arithmetic behind it. An issue is roughly 1,100 words of table and
a few hundred of prose. Six categories at one issue a month is 72 pages a year
whose tables differ and whose everything-else does not. A series of near-identical
pages generated from one template is precisely what Google's scaled-content-abuse
policy describes, and the honest defence against it is not a disclaimer — it is
that each issue genuinely says something the others do not.

So write what a table cannot: what moved, what surprised you, which of the open
terms you would actually take and why, what the shape of the phrases implies
about the category. Name specific rows. The August puzzle issue is built around
eight arrow-game terms whose leaders are all under fourteen months old — that
observation is not in any column, and it is the reason to read the page.

Do **not** narrate the columns. `/aso/rankgrip/` explains them once for the whole
series, and repeating it per issue is both the duplication problem above and the
filler that makes a data page read like content marketing. Link to it instead;
every issue already does.

**Use the name.** Every issue should say "Rankgrip" in its prose at least once,
with a number attached to a specific keyword — `game lucky arrows` has a Rankgrip
of 5. A metric becomes citable by being used consistently and quoted with real
values; a column heading nobody writes a sentence about stays a column heading.

## Rankgrip

The score every report is built on: how tightly a keyword is already held, 0–100.
Three files, and they have to agree.

| File | Holds |
| --- | --- |
| [`scripts/rankgrip.mjs`](../../scripts/rankgrip.mjs) | the formula, the weights, the band cuts |
| [`content/aso/_rankgrip.md`](_rankgrip.md) | the public definition, at `/aso/rankgrip/` |
| `_source/aso/*.json` | the weights each issue was actually scored with |

`_rankgrip.md` is `_`-prefixed so the issue loader skips it, and read by name in
`build.mjs`. It needs no snapshot.

**The weights are versioned into every snapshot on purpose.** A published report
has to keep meaning what it meant the day it shipped, so retuning the formula
does not silently restate seventy pages of back catalogue. If the weights ever
change, say so on `/aso/rankgrip/` and leave old issues alone.

**When the formula or the gate changes, the public page changes with it.** The
thresholds live in `scripts/aso-sql.mjs` and `scripts/rankgrip.mjs`; the
sentences describing them live in `_rankgrip.md`. Nothing checks that they agree,
so they only stay honest if you edit them together.

## The issues are not on the publishing calendar

`npm run schedule -- --claim` **refuses an ASO slug** and says so. The claim path
never checked that a slug was a real post, so claiming a report would have
written a blog slot in `_source/schedule.json` for a page that is not one —
eating a day's quota and only surfacing weeks later as "claim never became a
post". Put the date straight in the issue's frontmatter instead.

What `scripts/schedule.mjs` *does* know about the reports is one thing only:
whether something dated for today is missing from the live sitemap. That answer
drives the daily build's `due` output, and without it a scheduled report would
never be released — the build would simply not run. The calendar itself
(quotas, claims, violations) reads `content/blog` and nothing else.

`npm run schedule` paces *writing* — it draws a daily quota so nobody has to
decide. A monthly data report has its own cadence and would only compete for
slots it does not need. So `_source/schedule.json` never sees these, and
`content/aso/` is not scanned by `scripts/schedule-rule.mjs`.

## The gate, and why a person still reads the list

`scripts/aso-sql.mjs` holds the query, with every clause commented as the claim
it is. It filters to phrases Play's own autocomplete offers, drops any phrase
carrying a word fewer than 50 app names use (that is the brand filter), and
keeps only terms where a big developer holds three or fewer of the top ten.

That still leaves phrases no studio should chase — a meme, a mistranslation,
something off-theme. `_source/aso/exclude.txt` records those, with a reason, so
next month's issue makes the same call. The script proposes; a person keeps.
