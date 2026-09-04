---
title: The blast radius rule for AI coding
date: 2026-08-28
description: How I decide what an AI agent may change on its own — sorted by what a mistake costs to undo, not by how hard the task is. Three zones, and the check for each.
tags: [ai, claude-code, workflow, google-play]
devto: true
linkedin: false
draft: false
changes:
  - 2026-09-03 — Zone 2: what a reader caught about immutable assets, and why the fix is a query rather than a fingerprinted filename
---

My domain carries email as well as the website. When I moved this site to Cloudflare I sat
looking at the DNS panel for a good ten minutes before touching anything, because deleting
the wrong record there wouldn't break something I could see. It would break mail delivery:
quietly, days later, for messages that no longer existed to resend.

I have never once felt that way about a stylesheet.

That gap is what I use now to decide how much of a task an agent does on its own. Not how
hard the task is, and not how much I trust the model. Just one question — how expensive is
this to undo after it ships?

## The sorting mistake I made first

My instinct was to hand over the tedious work and keep the interesting work. Boilerplate,
config, CSS, build scripts, redirect maps: all yours. The "real" logic: mine.

That's backwards, and it took me an embarrassingly long time to see why. The tedious stuff is
tedious *because it's plumbing*, and plumbing is precisely the part that touches things
outside your repository — DNS, caches, crawlers, store metadata, ad configuration. Difficulty
and consequence aren't correlated at all. Some of the most trivial edits in this project are
the ones I'd least like to get wrong.

There's a well-documented pattern now of projects that moved fast with AI for a few months
and then hit a wall: features breaking other features, a codebase nobody understands, a
rewrite costing more than the original build. Reading through those post-mortems, the thing
that struck me is that it isn't mainly a code-quality problem. It's a reversibility problem.
You don't hit a wall because the code is ugly. You hit it because too many changes went
somewhere you can't cheaply back out of.

## Zone 1 — one command undoes it

Anything that lives in the repo, renders into `dist/`, and can be reverted with `git revert`
plus a redeploy. Page copy, styles, the generator, build scripts, blog posts, most refactors.

The agent works alone here. I describe what I want, it does it, CI checks it, I open the
preview URL. If it's wrong it's wrong for about two and a half minutes (the length of a
deploy) and the fix is one command. At that price, reading every line is a worse use of my
attention than occasionally fixing something.

This is the bulk of the work, and it's where all the speed comes from.

## Zone 2 — recoverable, but only if you notice

Things that are technically in the repo but whose failure mode is silence. Cache headers,
redirect maps, `robots.txt`, canonical URLs, structured data, the sitemap. Anything consumed
by a crawler, a browser cache or a third party instead of by a person.

Reverting isn't the issue. Nothing tells you. The site looks perfect, and it goes on looking
perfect for three weeks, until you notice traffic is off or a cache never invalidated or a
page was never indexed at all.

My cache rules looked completely fine in the diff:

```
/assets/images/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=86400
```

Here's what came back over the wire:

```
cache-control: public, max-age=86400, public, max-age=31536000, immutable
```

Overlapping rules concatenate. Browsers take the first value, so the year-long immutable
cache did precisely nothing. Nobody reading that diff would flag it, human or model, because
the diff *is* fine. Only the response was wrong.

So the rule in Zone 2 isn't "read more carefully." Reading was never going to find that. It's
verify against reality: either the check goes into the build, which is
[what I mostly do now](/blog/build-reviews-ai-code/), or I `curl` the deployed thing and read
what actually came back. "The deploy succeeded" and "the new behaviour is live and correct"
are two different claims and only one of them is checkable.

**Added after publishing.** A reader on the dev.to copy of this post,
[@vinhnguyenthanhdn](https://dev.to/vinhnguyenthanhdn), made the point I had missed: the
concatenation bug was *protecting* me. While the header was malformed the browser read
`max-age=86400` first, so the year never applied. Fix the concatenation and `immutable`
starts working — which is the moment it turns dangerous, because `immutable` is only safe
over a filename that changes when the file does.

They were right, and about a part of the site this post doesn't show. Game screenshots and
font subsets were served for a year under names that stay put when the file behind them is
replaced. Anyone who had already fetched one would hold those bytes for a year, and no
deploy reaches them — the browser isn't asking. They also named the limit of the `curl`
above: it reads what the origin answers now, so it covers new visitors and says nothing
about the ones already holding a copy.

The obvious fix is to fingerprint the filenames the way the JS bundle already is. I didn't,
and the reason is SEO. Google Images has these screenshot URLs indexed, and the filename is
itself an input — Google reads `soda-jam-02.jpg` to work out what the picture shows, which is
why the artwork got renamed off its internal codename in the first place and why the repo
still carries 301s for the old names. Fingerprinting means a new URL on every edit: the
indexed one 404s unless I add another redirect each time, and the replacement starts its
crawl from nothing.

So the hash goes in a query instead — `soda-jam-02.jpg?v=5137594b`. The filename never moves,
Google Images keeps one stable URL, no redirect is added, and the browser still sees an
address it has never fetched. Structured data and `og:image` stay bare for the same reason,
since a scraper wants the URL that doesn't move. The build now fails if one of those paths is
emitted without a key.

Which is this section arguing with itself. The failure was silent, it survived a review and
a build gate, and it was caught by someone checking against reality. Just not by me. Thanks
for the catch.

## Zone 3 — the undo doesn't live in git

Here I don't delegate, and it isn't about competence. It's that I need to be the person who
typed it.

- **DNS records.** See above. `MX` and `TXT` are a category of their own.
- **Google Play Console.** Store listings, content ratings, data safety declarations. Rolled
  out to production, a wrong answer is a policy problem rather than a bug, and the round trip
  to fix it is measured in days.
- **Any URL somebody else has already published.** The privacy policy URL for each of my
  games is entered in its Play Console listing. Those aren't mine to break. They get a 301 and
  a build check, permanently.
- **Secrets, tokens, scopes.** A permission set is a decision, not a task.
- **Anything where the dashboard uses the word "delete".**

The common property isn't danger exactly. It's that `git revert` can't fix it. If the undo
isn't in version control, I do it by hand, slowly, with the docs open in another window.

## Why the agent can't make this call

An agent optimises for finishing the task you described, and it's genuinely good at that.
What it can't weigh is what you'd lose if it's wrong, because that information isn't in the
repository and mostly isn't written down anywhere.

Nothing in my code says "these five routes are referenced from live Play Store listings that
take days to update." They look like any other routes. When an agent renames one it isn't
being reckless — it's being exactly as careful as the information it was handed.

Which points at the fix. Write the constraint into the repo, where the work happens. Mine
sits near the top of the README in plain language:

> It also hosts the privacy policy for every game. **Those URLs are referenced from Google
> Play Console listings — they must not break.**

I wrote that sentence for a future human. It happens to work just as well on an agent, which
turned out to be a much bigger deal than I expected and is
[a whole post of its own](/blog/context-engineering-repo/).

## Shrinking the radius beats classifying it

The real leverage isn't getting better at sorting. It's moving work *down* a zone until the
sorting stops mattering.

| Move | What it converts |
| --- | --- |
| Never commit to `main`; everything is a PR | production mistakes → preview-URL mistakes |
| A preview deploy per branch | "looks right in the diff" → "I loaded it" |
| Config in version control, not the dashboard | untracked drift → a reviewable diff |
| Build-time checks for the silent stuff | Zone 2 → Zone 1 |
| One deploy pipeline, not two | racing publishes → one gated publish |

That last row bit me. Cloudflare offers to connect your Git repository directly, and if
you're already deploying from GitHub Actions you quietly end up with two pipelines publishing
the same site: yours, which runs checks, and theirs, which doesn't. Whichever finishes last
wins. A build my pipeline had correctly refused to ship could get published anyway. Two paths
to production means your gate is advisory, and an advisory gate is decoration.

Every row there is dull infrastructure work. Together they're the reason it's reasonable to
let an agent write most of the code — not because the code got more trustworthy, but because
being wrong got cheap.

## In practice

Before handing something over I ask what it costs me if this ships broken and I find out in a
week. Two minutes and a revert, and I let it run without reading every line. Wouldn't find
out in a week, and I stop and build a check instead, because reading doesn't catch silent
failures and never has. Undo isn't in git, and I do it myself; it's ten minutes, once, and
it's the ten minutes that was actually worth my time.

The useful property of that rule is that it has nothing to do with how good the model is.
It's held up unchanged through three of them.
