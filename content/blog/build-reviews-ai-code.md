---
title: I don't review AI code. My build does.
date: 2026-08-28
description: Reading every diff at generation speed isn't review, it's skimming. Here is the 169-line verifier that gates this site, and the bug behind every check in it.
tags: [ai, claude-code, ci-cd, workflow]
draft: false
---

There's a ratio I spent a while pretending not to know about. Claude produces a plausible
two-hundred-line diff in roughly a minute. Reading two hundred lines of plausible code
properly — not skimming for shape, actually checking it — takes me fifteen or twenty. That
gap is the whole problem with "never merge AI-generated code without reading it," which is
advice I agree with and could not follow.

For a few months I scrolled diffs, recognised the shape of things, and merged. It felt like
reviewing.

What eventually gave it away was the *kind* of bug getting through. None of them were subtle
logic errors that careful reading would have caught. They were dull, mechanical things: a
dead internal link left behind by a route rename, an `<img>` with no `alt`, a canonical URL
pointing at the wrong host, two cache rules that turned out to concatenate. Every one was
something a fifty-line script could find in milliseconds, and none of them were things I was
ever going to reliably catch by eye at eleven at night.

So I stopped trying to read faster.

## The verifier

`scripts/verify.mjs` is 169 lines of dependency-free Node. It walks the built `dist/`
directory and exits non-zero on anything I've decided must never ship.

```
npm run check      # build + verify — the same gate CI runs
```

It runs on every pull request and the deploy job depends on it, so a branch that fails it
doesn't reach the internet. Not because I'm disciplined; because the pipeline is wired that
way. (That plumbing is in [the Cloudflare Workers post](/blog/static-site-cloudflare-workers/),
along with the five traps that cost me an evening.)

The link and image checks are the whole idea in miniature. Resolve every site-absolute URL
against what's actually on disk:

```js
/** does a site-absolute URL resolve to a real file? */
const resolves = url => {
  const clean = url.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return fs.existsSync(path.join(DIST, 'index.html'));
  const p = path.join(DIST, clean);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return true;
  return fs.existsSync(path.join(p, 'index.html'));
};

for (const href of attr(html, /href="(\/[^"#][^"]*)"/g)) {
  if (!resolves(href)) fail(where, `dead internal link → ${href}`);
}
```

Nothing clever. It's the kind of check that's tedious for a person to do on every page of
every build and free for a machine to do forever.

## Every check has a bug behind it

I didn't sit down and write a best-practices linter. Each rule went in on the day something
got past me:

| The check | What it's remembering |
| --- | --- |
| exactly one `<h1>` per page | a generated template that emitted two |
| `alt` on every `<img>` | accessibility regressions Lighthouse caught days later |
| dead internal links | a renamed route that left pages pointing at a 404 |
| `_redirects` targets resolve | a redirect pointing at a page I'd since deleted |
| no placeholder or filler copy | draft text left in a page, one merge from production |
| Blogger markup in output | migration leftovers surfacing weeks after the migration |
| every page listed in `sitemap.xml` | new pages that silently never got submitted |

**Resist the urge to write the exhaustive rulebook up front.** I tried; you end up with forty
rules, six of which ever fire, and the other thirty-four generate enough noise that you stop
reading the output at all. Which is worse than having no verifier, because now you also
believe you have one.

## The checks that pay for themselves are invisible

The rules I'd least want to lose guard things I would never notice by looking at the site,
because the site looks fine.

This one validates the IndexNow key file:

```js
// scripts/seo-ping.mjs submits URLs under this key; the crawlers reject the
// submission unless the matching file is live at the site root.
const key = fs.readFileSync(KEY_FILE, 'utf8').trim();
if (!/^[a-f0-9]{8,128}$/.test(key)) fail('indexnow', `key is not 8-128 hex chars: "${key}"`);
else if (!fs.existsSync(p))         fail('indexnow', `missing key file /${key}.txt`);
```

Ask an agent to "add IndexNow submission" and you'll get a correct submission script and no
key file, because nothing in the request mentions one. It isn't being careless. It has no way
to know what the silent failure costs, and a missing key file fails silently by design — the
crawler just ignores you. Same story with `app-ads.txt`, which is read by ad networks and
nobody else, and which is now parsed field-by-field at build time against the IAB spec.

## Numbers for the things a script can't see

Alongside the verifier there's a Lighthouse budget, and it isn't negotiable:

```
performance ≥ 90, accessibility ≥ 100, best-practices ≥ 100, seo ≥ 100
```

This catches the failure the verifier can't: slow drift. No single change makes a site slow;
twenty changes, each fine on its own, do, and you never see the moment it happens because you
were looking at diffs rather than at scores.

A real one: the grey I use for code comments in these posts failed WCAG contrast. It looked
deliberate. Honestly, it looked good. One-line fix, and I would never have found it by
reading a stylesheet — the budget found it on the pull request (commit `d64bce0`, if you're
curious).

Performance measurement on shared CI runners is noisy, so the gate re-measures instead of
failing on one bad sample:

```js
// Only performance is re-measured, and only when it misses.
while (scores.performance < BUDGET.performance && attempts < RETRIES) { … }
```

That detail matters more than it looks. **A gate that fails at random gets ignored, then
disabled, then deleted.** Flaky checks teach you to click through failures, which is the exact
habit you built the gate to prevent.

## Write the error message for the agent

One thing I'd underrated. Compare:

```
  ERROR  /blog/index.html: dead internal link → /games/word-slot
```

with a generic "validation failed". The first I can paste straight into a session and get a
correct fix in one turn; the second starts a conversation. Good error messages were always
worth writing. They're worth roughly double now, because the agent reads them too, and a
precise message is the difference between a fix and a guess.

## What it doesn't do

It has no opinion about whether the code is any good. It won't tell me a function is a mess,
that an abstraction is wrong, or that the feature was a bad idea in the first place. That's
still my job, and now it's the only reviewing job I have — which is a better trade than it
sounds, because the mechanical layer is where all the volume is.

It also can't tell me the agent touched something it shouldn't have gone near at all. That's
a different problem and I handle it differently; it's in
[the blast radius rule](/blog/blast-radius-rule-ai-coding/).

The transferable bit isn't "write a verifier for your static site." It's the question I now
ask every time I catch something in a diff: could a script have caught this? When the answer
is yes, writing the script beats remembering the lesson, because I don't reliably remember
lessons and the script doesn't get tired.
