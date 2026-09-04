# Announcing a blog post on LinkedIn, from CI

> **Full write-up:** [Four things break when CI posts to LinkedIn](https://www.indiecore.net/blog/posting-to-linkedin-from-ci/)

A Node script and a GitHub Actions workflow that put a blurb and a link card on your own
LinkedIn feed when a post goes out. No dependencies beyond Node 22.

```
node linkedin.mjs             # dry run — the exact text, as a reader will see it
node linkedin.mjs --publish   # post it, after showing it and asking
node linkedin.mjs --check-token
```

It is not a cross-post. LinkedIn gets a few lines of commentary and a link card rather than a
copy of the article, so nothing over there competes with the page it points at and no
canonical tag is involved.

## Files

| File | What it is |
| --- | --- |
| `linkedin.mjs` | Reads posts, composes the text, posts it, records what went out |
| `linkedin.yml` | Goes in `.github/workflows/` — daily schedule and manual dispatch |

## Setup

1. Create an app at **linkedin.com/developers/apps/new**. It wants a LinkedIn **Page** to
   attach to and will not take a personal profile; make one first if you have none, then
   **Verify** the app as that Page's admin.
2. Products tab, add **both**: *Share on LinkedIn* for `w_member_social`, and *Sign In with
   LinkedIn using OpenID Connect* for `profile`. The second is easy to skip and posting
   works without it — until the author lookup returns 403.
3. Mint a token with the portal's **token generator**, ticking `openid`, `profile` and
   `w_member_social`. Tick the same three on every renewal: LinkedIn invalidates existing
   tokens when a different scope set is requested.
4. Repository secrets: `LINKEDIN_ACCESS_TOKEN` to post, plus `LINKEDIN_CLIENT_ID` and
   `LINKEDIN_CLIENT_SECRET` for the expiry check.
5. Opt a post in with `linkedin: true` and a `linkedinText` blurb in its frontmatter.

## Things that will bite you

- **The token expires every 60 days and there is no refresh token** outside the Marketing
  Developer Platform. The workflow runs `--check-token` first on every run, before it looks
  at whether anything is waiting, because the failure that matters is a green job with
  nothing in it on the morning a post was due.
- **A token can be active and still unable to post.** Requesting a different scope set
  invalidates existing tokens, so a renewal with fewer boxes ticked gives you a valid token
  that 403s. The check reads the `scope` string, not only `active`.
- **You cannot ask LinkedIn what you already posted** — that needs `r_member_social`, which
  is restricted. The ledger file is the only record, and it is written after every single
  post rather than at the end of a run.
- **A post cannot be re-run into place.** The commentary can be patched; the link card
  cannot. Hence no push trigger, and a cap of one new post per run.
- **`commentary` is not plain text.** Fourteen characters are reserved by LinkedIn's
  `little` format and every one must be backslash-escaped even where it is plainly not
  markup. Hashtags are a template, not a literal `#tag`.
- **LinkedIn autolinks anything shaped like a domain** and does not check that it resolves.
  A filename in the text published as a link to a host that does not exist. There is no fix
  inside the format, so the script refuses to publish text containing one.

## Adapting it

`BLOG`, `SITE` and `THUMBNAIL` at the top are the only site-specific parts. The
frontmatter parser expects `title`, `date`, `description`, `tags`, `draft` and the two
`linkedin` fields; swap it for your own and the rest is unchanged.

---

Written up in full here: **[Four things break when CI posts to LinkedIn](https://www.indiecore.net/blog/posting-to-linkedin-from-ci/)**

_Generated from the live scripts — see the post for the reasoning behind each guard._
