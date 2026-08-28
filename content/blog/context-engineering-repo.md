---
title: I stopped writing prompts. I write the repo.
date: 2026-08-28
description: The best prompt I ever wrote was a README. What changed when I moved my conventions out of the chat window and into the files they describe.
tags: [ai, claude-code, context-engineering, workflow]
draft: false
---

For about a year I got better at asking. Longer prompts, worked examples, careful phrasing, a
private collection of formulations that seemed to work. It helped for a while and then it
stopped helping, and what bothered me was the inconsistency: the same request would produce
good work on a Monday and something mediocre on a Thursday.

The reason is obvious in hindsight and was invisible at the time. On Monday I'd been in the
same files for an hour and the session knew the codebase. On Thursday I'd opened a fresh one
and asked the same question of something that knew nothing about the project.

The prompt was never the variable.

There's a name for the shift now — prompt engineering giving way to *context engineering*,
tuning the whole information environment rather than the request. Written up at industry
scale it sounds like a programme of work. For one person with a small repo it collapses to
something much smaller: whatever you'd have to explain to a competent new contributor on
their first morning, write it down, in the repo, near the work.

The pleasant surprise is that this is all documentation you should have written anyway. It
just never paid for itself before, because you were the only reader.

## The best prompt I ever wrote was a README

`content/blog/README.md` is the guide to writing a post on this site. It exists because I
kept re-explaining the same things to myself after a few weeks away.

It carries a frontmatter table:

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Build fails without it. Aim for under 48 characters — the site name is appended. |
| `date` | yes | `YYYY-MM-DD`. Controls ordering. |
| `draft` | no | `true` keeps it out of the site, sitemap and RSS entirely. |

It has the four post shapes that work here, each with a skeleton. It has the rule about where
images live. And it has this, which I'll come back to:

> **Prefer anchors over line numbers.** `#head` and `#<jobname>` are resolved from the YAML
> structure, so they keep pointing at the right thing when the file changes above them. Line
> numbers silently start showing the wrong code.

All of that was written for me. It has turned out to be the highest-leverage file in the
project, because "write a post about X" now produces something with correct frontmatter, a
shape that suits the site and the right embed syntax, with no prompt beyond the topic.

There are only two ways to get that outcome. Paste your conventions into every request
forever and hope you never forget one, or write them once, in the place they belong, and have
them be true for every session, every contributor, and your own memory in six months.

## Keep it next to the thing it describes

Standard advice is a single instructions file at the repository root. Mine is deliberately
thin, and the substance sits beside what it governs: writing rules in `content/blog/`,
branching and commands in `CONTRIBUTING.md`, architecture and deploy setup in the root
`README.md`.

Context-window economy is part of it — a page of relevant rules beats ten pages of mostly
irrelevant ones. But the bigger reason is maintenance. A root file describing five subsystems
drifts from all five, because updating it is nobody's job in particular. A README sitting in
the directory it describes gets fixed by whoever was just annoyed by it, which is the only
mechanism I've ever seen keep documentation true.

## Write down why, not just what

This is the one I'd argue hardest for. Compare:

```
Use #anchors in gist embeds, not line numbers.
```

with the version I actually wrote, which explains that anchors resolve from the YAML
structure and survive edits above them, while line numbers *silently* start showing the wrong
code.

The first is a rule. It gets followed while it's in context and dropped the moment a case
comes up that nobody wrote down. The second is a reason, and reasons generalise. This has
always been true of good documentation; it's just far more visible now, because you can
watch an agent extrapolate correctly from a reason and flounder against a bare instruction.

Same inside the code. This comment earns its keep:

```js
// scripts/seo-ping.mjs submits URLs under this key; the crawlers reject the
// submission unless the matching file is live at the site root.
```

Nothing in the surrounding lines explains why a random hex file has to exist at the site
root. Delete the comment and the check looks arbitrary, and checks that look arbitrary get
removed by the next person who reads them (including, eventually, me).

## Better still, make it fail

Prose rots. Prose that can't rot is better.

Posts here embed code out of a `gist/` directory by filename, and the build fails if the
filename doesn't exist. That isn't documentation about keeping articles in sync with the code
they describe; it's a guarantee. A renamed file can't leave a silent hole in a published
post, because nothing gets built.

`npm run check` is the same trick applied to process — build plus verify, the exact command
CI runs. Not eight things to remember before pushing. One command, and because the pipeline
uses it too, it can't drift away from what CI actually enforces.

Any constraint you can turn into a failing build is a constraint you stop having to explain
to anyone, ever again.

## Say what's dangerous, in the danger's own words

The most valuable line in my README has nothing to do with architecture:

> It also hosts the privacy policy for every game. **Those URLs are referenced from Google
> Play Console listings — they must not break.**

There's no way to derive that from the code. The routes look like every other route. That
sentence is the only thing standing between a perfectly reasonable refactor and five broken
links in live Play Store listings.

An agent renaming that route isn't being reckless. It's being exactly as careful as the
information available to it, which is why the information has to be available. Every
genuinely irreversible thing in a project deserves one sentence like that, in the file
somebody would actually have open at the time. (Where I draw that line is
[the blast radius rule](/blog/blast-radius-rule-ai-coding/).)

## Stale docs are now a liability, not an embarrassment

This part changed with agents and I don't think it's said often enough. Out-of-date
documentation used to be mildly embarrassing. Now it's actively dangerous, because an agent
will believe it and act on it, confidently, without the human instinct that says *hang on,
this file looks like it's from last year*.

So context files need the discipline you'd apply to code. If a rule stops holding, delete it
in the same commit that made it false. If a section describes how you wish the project
worked, it doesn't belong. Don't restate what the code already says plainly — a prose summary
of a function is a second source of truth, and the two will disagree within a month.

Short and true beats comprehensive and half-rotten.

## What actually changed

My prompts got shorter. That's the whole visible result.

"Write a post about the Cloudflare traps" is a complete instruction in this repo, because the
shape of a post, the frontmatter, the embed syntax, the voice, the publishing flow and the
constraint about legacy URLs are all written down somewhere the agent will look. In a repo
without any of that, the same sentence needs three paragraphs of scaffolding, and I'd forget
one, and get something subtly wrong-shaped back.

The work moved out of the conversation and into the codebase. It feels slower, because
writing a README is nowhere near as satisfying as watching code appear. But it's the only
part that compounds — a good prompt helps once, and a good repo helps in every session after
it, including the ones you have with other people.

If you want to know where yours stands: open a completely fresh session, with no history, and
ask for something ordinary. Whatever you find yourself explaining before it can start is
exactly what's missing from your repository, not from your prompt.
