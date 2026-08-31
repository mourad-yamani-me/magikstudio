# Working in this repo

Conventions for anyone — person or coding agent — making changes here. Read this first; it is
short on purpose. The detail lives next to the work, and this file says where.

`README.md` covers the stack and one-time setup. `CONTRIBUTING.md` covers branching and local
commands. This file covers the things that are **not derivable from the code** and that will
bite you if you guess.

## The one command

```bash
npm run check      # build + verify — the same gate CI runs
```

Run it before every push. If it fails, the branch cannot deploy, so there is no value in
pushing first and finding out from CI.

Optional, and worth it when the change is prose or performance:

```bash
npm run style      # flags writing that reads as machine-written (advisory)
npm run lighthouse # the performance/a11y/SEO budget
npm run gist       # regenerate gist/ from the live files
npm run seo        # submit new URLs, then report index status and search performance
npm run seo:watch  # what Search Console says changed, and what to do about it
npm run topics     # what to write next, and the success condition for each subject
```

## Never break these

- **Privacy policy URLs are referenced from Google Play Console listings.** `/privacy/<game>/`
  and the legacy Blogger paths that 301 to them. They are entered in five live store listings
  and are not ours to break. Renaming one is a store problem, not a bug. If a route must move,
  it moves *and* keeps a 301.
- **Deploys happen through GitHub Actions only.** Never `wrangler deploy` by hand, never
  connect Cloudflare's own Git integration in the Worker settings. Two pipelines publishing
  the same site race, and the one without checks can win.
- **Never touch `MX` or `TXT` DNS records.** The domain carries email. `A`/`CNAME` changes
  cannot affect mail; deleting an `MX` or SPF `TXT` breaks it silently, days later.
- **`/privacy/` is a legal document, not marketing copy.** It names the data controller, the
  legal basis for each processing, the Article 15–22 rights and the CNIL as supervisory
  authority. `scripts/verify.mjs` fails the build if any of those disappear. Rewriting it for
  tone is fine; dropping a required part is not.
- **Half the mailing list lives in Kit, where the repo cannot see it.** `/subscribe/thanks/`
  and `/subscribe/confirmed/` are redirect targets typed into the Kit form settings, and the
  form posts to a form ID and two custom fields (`interest`, `source`) created there.
  Renaming a route or a field name here breaks a setting no one can grep for. `verify.mjs`
  catches a deleted page; it cannot catch a renamed one. The constants are in `KIT` at the
  top of `build.mjs` — change them and the Kit account together.
- **`form-action` is checked on every hop of a redirect chain**, not just the POST target.
  Kit answers the signup with a 302 to the apex domain, which 301s to `www`, so all three
  hosts sit in the CSP. Chrome reports a blocked hop against the *original* URL, which reads
  like a false positive and sends you looking at the one part that works.
- **Never commit to `main`.** Branch (`feat/`, `fix/`, `content/`, `chore/`), open a PR, let
  the preview URL build, squash-merge. `main` deploys to production on merge. The one
  exception is `_source/seo-watch.json`, which the SEO watch workflow commits daily — one
  machine-written file, ignored by the deploy trigger, never part of the site. Everything
  its findings ask you to *change* still goes through a branch and a PR.

## Staging changes

**Stage explicit paths. Never `git add -A` or `git add .`** — unrelated work is often sitting
in this tree, and a broad add sweeps it into someone else's commit.

```bash
git add scripts/verify.mjs content/blog/my-post.md    # yes
git add -A                                            # no
```

## Where the rules actually live

| Doing this | Read |
| --- | --- |
| Writing a blog post | [`content/blog/README.md`](content/blog/README.md) — frontmatter, post shapes, gists, style check |
| Choosing what to write | [`content/blog/README.md`](content/blog/README.md#choosing-what-to-write) — `npm run topics`, and the success condition every subject carries |
| Branching, local commands | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Stack, deploy setup, secrets | [`README.md`](README.md) |
| Changing game copy or routes | the `GAMES` array in `build.mjs`; store metadata in `_source/play-data.json` |
| Changing a privacy policy | `_source/legacy/*.txt` — the text is parsed from there |
| Changing the mailing list | the `KIT` block in `build.mjs`, and the matching settings in the Kit account |
| Acting on Search Console | [`docs/seo-automation.md`](docs/seo-automation.md) — `npm run seo:watch -- --brief` prints the open findings and the fix each one implies |

Those files are the source of truth. If something here disagrees with them, they win, and
this file is the one to fix.

## Publishing code alongside a post

**A post that explains a script must link the script.** Decide this while drafting, not after
— three posts shipped with inline snippets and no `code:` card because nobody checked at the
end.

Gists are generated from the real files by `scripts/build-gist.mjs`, never hand-copied, so
they cannot drift from what the repo runs. One subdirectory per gist under `gist/`. The full
procedure — adding a `GISTS` entry, the marker rule, the two-step for the URL — is in
[`content/blog/README.md`](content/blog/README.md#publishing-a-gist-for-a-post).

Not every post needs one. A post about a decision or about documentation has no artifact to
publish, and inventing one is worse than omitting it. The build warns when a gist points at a
post that has no `code:` field, which is the case worth catching.

## How to add a check

Every rule in `scripts/verify.mjs` exists because something got past a review. Follow that:

- **Add a check for a bug that actually happened**, not for a rule that sounds sensible. Forty
  speculative rules produce noise, and noise gets ignored, then disabled, then deleted.
- **Make it fail loudly and name the fix.** `dead internal link → /games/word-slot` can be
  acted on directly. "Validation failed" starts a conversation.
- **A flaky check is worse than no check.** The Lighthouse gate re-measures performance rather
  than failing on one noisy sample, for exactly this reason.
- **Calibrate against this repo, not a generic list.** `scripts/style-check.mjs` deliberately
  does not flag em dashes: the site runs about ten per thousand words and always has.

## Assets that CI cannot regenerate

`npm run assets:og` needs Chrome and ImageMagick; `npm run assets:fonts` needs Python and
fontTools. CI does not install either, so their output under `public/assets/` is committed.
Run them locally and commit what changes.
