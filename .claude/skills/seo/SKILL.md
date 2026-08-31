---
name: seo
description: Work the open Search Console findings for indiecore.net — read the ledger written by `npm run seo:watch`, fix what can be fixed in this repo, and close each finding with what was done. Use when asked to "do the SEO work", "check search console", "what's the SEO status", or to act on a SEO watch issue.
---

# Working the SEO findings

`scripts/seo-watch.mjs` observes Search Console and records findings in
`_source/seo-watch.json`. It never edits the site — that part is this skill.
Read `docs/seo-automation.md` for what each finding kind means.

## Start here

```sh
npm run seo:watch -- --brief
```

Reads the committed ledger only: no network, no credentials, works offline. If it
says *No ledger yet*, no watch run has landed — say so and stop rather than
guessing at work to do.

Do **not** run `npm run seo:watch` (without `--brief`) just to look. It needs
credentials, and on a developer machine it writes a ledger commit that belongs to
CI. `--brief` is the read.

## Then

Work findings in the order `--brief` prints them; it is already sorted by how
much each one matters. Take the ones this repo can actually fix, in a branch:

```sh
git checkout -b fix/seo-<something> main
```

| Finding | What to actually do here |
| --- | --- |
| `deindexed` | Check the page is in `dist/` after `npm run build`, returns 200, is in `sitemap.xml`, and carries no `noindex`. If the page is fine, the fix is outside the repo — say so and leave the finding open. |
| `never-crawled` | A discovery problem, so add real internal links from pages Google already crawls. Do not "submit harder"; it does nothing. |
| `near-miss` / `zero-click` | Rewrite the `<title>` and meta description of the page that ranks, so the phrase people typed is visible in the result. The copy lives in `build.mjs` (`GAMES`) or in the post's frontmatter. |
| `position-slip` | Read the post against what now outranks it, and find the section it is missing. This is writing work — see `content/blog/README.md`. |
| `stale-crawl` | Usually nothing. Close it `--wontfix` unless the content genuinely changed. |
| `sitemap-*` | Inspect the generated `dist/sitemap.xml` and the sitemap logic in `build.mjs`. |

## The rules that still apply

- `npm run check` before every push. It is the gate CI runs.
- Never `git add -A`. Stage the explicit paths you changed.
- Never commit to `main`. Branch, PR, squash-merge.
- Privacy policy URLs are load-bearing in five live Play Store listings. A
  finding is never a reason to rename one. If a route must move, it moves *and*
  keeps a 301.
- Titles and descriptions have budgets `scripts/verify.mjs` enforces: 65 and 165
  characters. Rewriting a title to chase a keyword and blowing the budget fails
  the build.

## Closing a finding

Only after the work is actually done and `npm run check` passes:

```sh
npm run seo:watch -- --close=<id> --note="what you changed"
```

Stage `_source/seo-watch.json` along with the fix, so the record and the change
land in the same commit.

Close a finding only when *you* fixed it. One whose condition has stopped being
true on its own is resolved automatically by the next watch run — do not
pre-empt that, and do not close a finding to tidy the list. `--wontfix` is for a
finding that is real but deliberately not worth acting on, and it wants a note
saying why.

## What not to do

- Do not invent findings the ledger does not contain, and do not act on a hunch
  about what Google wants. The ledger is the work list precisely because it is
  evidence.
- Do not touch `_source/seo-watch.json` by hand. Use `--close` / `--wontfix`.
- `npm run topics` is a different tool for a different question — what to *write*
  next. It has its own ledger. Do not conflate the two.
