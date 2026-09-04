# Cross-posting to dev.to

A copy of a post, published on dev.to, pointing back here. It exists for two reasons and it
is worth being precise about which is which, because the second one is the one people get
wrong.

## What this actually buys

**A followed link.** Everything GitHub renders from user markdown — gists, repo READMEs,
profile READMEs — carries `rel="nofollow"`. That is not a setting a gist owner can change,
so the ten gists under `gist/` will never pass ranking signal no matter how they are
written. dev.to does not do this. Measured against live articles before any of this was
built:

```
followed 129 · nofollowed 1     outbound in-body links, 18 recent articles
followed 6   · nofollowed 0     links to the author's own domain, canonical-carrying posts
20 of 20                        articles emitting <link rel="canonical"> to the original
```

The single nofollow was a YouTube link, so the behaviour looks link-type-specific rather
than account-specific — but it is a sample, not a guarantee, and dev.to can change it.
**Check a published article before assuming**, which is one command:

```bash
curl -sL <article-url> | grep -o '<a[^>]*indiecore\.net[^>]*>'
```

**Their readers.** Secondary, but real, and it does not depend on any of the above holding.

## The rule that is not optional

**Every cross-post sets `canonical_url` back to this site.** Without it the dev.to copy
competes with the original for the same query, on a domain with far more authority than
this one — and it can win. A cross-post that outranks the page it was meant to promote is
worse than no cross-post. `scripts/devto.mjs` sets it on every article it sends and never
offers a way not to; nothing here should grow one.

## Doing it

Opt a post in with one frontmatter line:

```yaml
devto: true
```

Then:

```bash
npm run devto                              # dry run — what would be sent, and to where
npm run devto:publish                      # create or update, live
node scripts/devto.mjs --publish --draft   # same, but left unpublished on dev.to
node scripts/devto.mjs --only <slug>       # just one
```

`DEVTO_API_KEY` must be set for anything that writes. Create one at
**dev.to → Settings → Extensions → DEV API Keys**.

Nothing is sent for a post without `devto: true`, and nothing is ever sent for a draft — or
for a post dated ahead of today, which the site is still holding. The canonical points back
here, so an article published before its own canonical exists would point at a 404. The daily
run is scheduled after the site's own (15:41 UTC against 14:09) for the same reason, and picks
the post up the afternoon it goes live.

## `devto` is a required decision

The build refuses a post whose frontmatter does not say `devto: true` or `devto: false`, the
same gate `linkedin` carries and for the same reason — a pure opt-in fails by being forgotten,
and forgetting is invisible: nothing breaks, nothing goes red, the post simply never leaves the
site.

That is not a hypothetical here. Twenty posts shipped in one batch on 2026-09-01 and every one
of them carries `devto: true`. The next three, written one at a time from a template that never
mentioned the field, all dropped it, and none was ever cross-posted. Nobody noticed until the
flags were listed against the dates.

`false` is a real answer. A post you want kept off a developer aggregator should carry it.

## Who gets the slot

The flag is a **veto, not a vote**. `devto: false` means never and nothing overrules it. Among
the posts that said yes, the queue is ordered by how much traffic the subject is worth — the
same rank `npm run schedule` prints, from `scripts/topic-seo.mjs` — and the run takes the top
of it.

It used to be ordered by date, which meant the scarce reach went to whatever happened to be
written first. With twenty posts opted in and three creations a run, that is spending it at
random. A post with no topic in the ledger ranks last rather than not at all: several predate
the ledger and should still go out, just not ahead of a subject with five thousand readers a
year attached to it.

Two caps apply and the smaller wins:

| Cap | Where | Guards against |
| --- | --- | --- |
| `perRun` / `perWeek` | `_source/schedule.json` → `platforms.devto` | the feed — how much of this account is links to one outside domain |
| Forem's own limit | the account's age, read from the API | the account being suspended |

`npm run devto` prints the ranked queue and the cap with the reason it came out at that
number. `--limit N` overrides both, which is the escape hatch for a backlog someone is
watching.

**The weekly budget is below the site's own rate on purpose, and that is not a backlog.**
The site publishes 30–60 posts a month; dev.to takes about 22. The gap is what makes this a
selection rather than a queue, and the selection is the whole point: every run re-ranks all
the opted-in posts from scratch, so the slot goes to the best subject waiting no matter when
it was written, and a post that is never the best is never sent. Ordering by date would have
spent the same scarce reach on whichever post happened to be oldest.

So the run says "below the cut" rather than "held for a later run". The second was what it
used to say and it was a promise the budget cannot keep. `npm run schedule` prints the budget
against the number opted in, so the gap is visible rather than something to discover.

## Why every post can opt in at once

Because creations drip. These are Forem's own limits, read off
`app/models/settings/rate_limit.rb` rather than from anyone's memory:

| limit | value |
| --- | --- |
| `published_article_creation` | 9 per 30s |
| `published_article_antispam_creation` | **1 per 300s** — for "new" users |
| `user_considered_new_days` | 3 |
| `article_update` | 30 per 30s |

An account younger than three days may publish **one article every five minutes**, so
nineteen posts cannot go out as one run however the script is written.

The limit is not the real risk though. A new account publishing nineteen articles in a
burst, every one canonicalised to the same outside domain, is the shape dev.to moderators
suspend — and a suspension costs every link on the account at once.

So `scripts/devto.mjs` caps how many *new* articles it creates per run: **1 while the account
is under three days old, 3 after**, overridable with `--limit N`. The daily schedule in
`devto.yml` works through the backlog. Updates are not capped — they are cheap, they are not
the spam signal, and holding back an edit to an article that already exists helps nobody.

An article whose stored markdown already matches what would be sent is skipped without a
request, so a scheduled run with nothing to do makes no writes at all.

**That comparison ignores fence languages, deliberately.** dev.to labels an unlabelled code
fence itself, and not with a fixed value — it detects the language, storing ` ```conf ` or
` ```http ` where we sent a bare ` ``` `. Compared literally, no article could ever look
unchanged, and every scheduled run rewrote all of them; the first run after the drip shipped
reported nineteen updates when nothing had changed. Blanking the info string on both sides is
what makes the comparison mean *the code and prose are the same*. The cost is that changing
only a fence's language no longer counts as a change — worth it, because the alternative is
sending ` ```plaintext ` ourselves to force a match, which suppresses the detection and loses
syntax highlighting on every unlabelled block.

On a `429` the script waits once if the retry window is short (Forem's ordinary 30s throttle)
and otherwise **stops the run cleanly and exits 0**, because being rate limited is the
expected steady state of a drip rather than a fault. The next scheduled run continues from
where it stopped.

## What the script changes on the way out

Three mechanical differences between what this site renders and what dev.to needs:

- **`{{gist:…}}` is expanded** into a plain fenced block, using the same lines the site
  inlines — `scripts/gist-embed.mjs` decides which lines, and both renderers call it, so a
  cross-post cannot show different code than the post it copies.
- **Root-relative links are absolutised.** `](/blog/x/)` would resolve against dev.to
  otherwise. Absolutising them also turns every internal link in the post into another
  followed link back here, which is most of the value in a post that links its neighbours.
- **A link to the original is added** at the top and the bottom. Top gets clicked, bottom
  gets copied by whoever quotes you.

## Running it twice is safe

Articles are matched by their `canonical_url`, so a second run updates the article the first
run created rather than posting a duplicate. Editing a post here and re-running pushes the
edit.

The API can unpublish an article but **cannot delete one**, so a mistaken create is a manual
cleanup on dev.to. That is why `--publish` lists what it is about to create and asks first.

## Why Reddit and Hacker News are not automated

Reddit, Hacker News and Lobsters nofollow everything, so they are worth posting to for reach
and worth nothing for links — and all three treat automated self-promotion badly enough that
scripting it would cost more than it returns. Post there by hand, when the post is genuinely
relevant to the room.

LinkedIn is the exception, and it lives in [`docs/linkedin.md`](linkedin.md): it is a feed
rather than a room, announcing your own writing is what it is for, and what goes out is a link
card rather than a copy of the article — so none of the canonical rules above apply to it.

---

## The snippet hub

`hub/` is a single page — generated by `npm run hub` — that indexes all ten gists, each with
the post that explains it. It exists because the gists have no home page: each one is
findable only if you already know it exists, and every link out of them is nofollow.

**It is not published from this repo.** This repo is private and owned under a real name;
the gists are published under `IndieCoreDev`, and `build-gist.mjs` strips every identifying
string on every build to keep the two apart. Serving Pages from here would join them in one
commit. `sync-hub.yml` pushes `hub/` to a public repo on the `IndieCoreDev` account instead,
and `build-hub.mjs` runs the same leak guard over its output.

It is an index, not a copy. A third copy of the same prose — post, gist README, hub — would
compete with the original for the same queries and be worth less than the one link it
carries. Every entry is a title, a sentence and its links out.

### One-time setup

1. Sign in as `IndieCoreDev` and create a **public** repo named `IndieCoreDev.github.io`.
   The name is what makes Pages serve it at the root; it is repeated in `HUB_REPO` at the top
   of `scripts/build-hub.mjs` and in `sync-hub.yml`, and all three have to agree.
2. Settings → Pages → deploy from the `main` branch, root. Public repos get Pages free.
3. Create a classic PAT on that account with **`repo` scope**, and add it here as the
   `HUB_TOKEN` secret. `GIST_TOKEN` cannot be reused — it is `gist`-scope only, deliberately.

After that it maintains itself: adding a gist adds a card on the next merge to `main`.
