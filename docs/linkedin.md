# Posting to LinkedIn

`scripts/linkedin.mjs` puts a short blurb and the article's link on your own LinkedIn feed. It
is the sibling of [`docs/cross-posting.md`](cross-posting.md) and it works on a different
principle, which is the first thing to be clear about.

**It is not a cross-post and it needs no canonical.** dev.to gets the whole article, which is
why the canonical rule there exists. LinkedIn gets a few lines of commentary and a link card —
no copy of the prose exists there, so nothing can outrank the page it points at. The link is
the content of the post rather than a footnote on it.

## Doing it

Two frontmatter fields, one of them optional:

```yaml
linkedin: true
linkedinText:
  - The hook. One or two sentences, in your voice, that stand on their own.
  - What you actually did, and what came out of it.
```

Without `linkedinText` the post goes out as its own title and description, which works and
reads like a machine wrote it. Write the blurb.

**New posts only. The back catalogue is deliberately not announced.** Nineteen posts were
already published and unannounced when this shipped, most of them dated the same day, and
opting them all in would have dripped one link a day for three weeks. That is comfortably
inside LinkedIn's API limits — 150 requests per member per day, about four per post — and well
outside what a personal feed absorbs: more than roughly one post a day suppresses the reach of
each one, and three straight weeks of daily self-links to the same domain reads as automation
whether or not it is. Four or five posts with a real hook would beat all nineteen, and doing
none of them costs nothing that was not already lost. So the flag goes on a post when it is
written, and old posts stay off the feed unless there is a reason to bring one back.

```bash
npm run linkedin                             # dry run — the exact text, rendered as a reader sees it
npm run linkedin:publish                     # post it, after showing it and asking
node scripts/linkedin.mjs --only <slug>      # just one
node scripts/linkedin.mjs --json             # also print the request body, for when LinkedIn says no
node scripts/linkedin.mjs --force            # post one that is already out, again
```

Nothing goes out for a post without `linkedin: true`, for a draft, or for a post dated ahead of
today — the link is the whole post, so publishing before the page exists would put a 404 on the
feed. **Run it after the site's daily build has released the post**, the same ordering the gist
and the dev.to article follow.

One post per run by default. This is a personal feed, not a publication: two links a minute
apart read as a bot, and the second earns less reach than it would have earned the next day.
`--limit N` overrides it.

## The daily workflow

`linkedin.yml` runs at **16:12 UTC** daily — after devto.yml's 15:41, which is after the site's
own 14:09. The ordering is one rule applied three times: nothing announces a post before the
build that publishes it has deployed.

It has **no `push` trigger**, unlike `devto.yml`. A dev.to article can be re-run into place, so
a push-triggered mistake there fixes itself; a LinkedIn post cannot be edited, and a post
landing on `main` must not put anything on a feed by itself. Schedule and manual dispatch only,
and the dispatch takes a `dry_run` box.

The workflow commits `_source/linkedin.json` back to `main`. That is the second of the two
exceptions to *never commit to main* in [`AGENTS.md`](../AGENTS.md), and it exists because the
ledger is the only memory of what has gone out — a run that posts without recording it posts
the same thing again tomorrow. `ci-cd.yml` ignores that path, so the commit does not redeploy
the site.

## The token, and the one thing that will break

LinkedIn access tokens last **60 days**, and programmatic refresh tokens go to approved
Marketing Developer Platform partners only — for an ordinary app there is no renewing one
without a person in a browser. So the secret under the workflow expires six times a year, and
no amount of workflow design changes that.

What the workflow can do is refuse to fail quietly. **The failure that matters is not this job
going red — it is this job going green with nothing in it, on the morning a post was due.** So
`--check-token` runs first on every run, before the workflow looks at whether anything is even
waiting:

```bash
node scripts/linkedin.mjs --check-token
# token active · 47 day(s) left · scopes: openid, profile, w_member_social
```

- **Under 14 days left** — a `::warning::` annotation and a line in the job summary. Enough
  notice to renew between two posts rather than during one.
- **Expired, revoked, or missing `w_member_social`** — the job fails outright and posts
  nothing. Red every morning until you renew, which is the intent.
- **`LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` not set** — the check is skipped with a
  notice rather than failing. Posting still works; only the early warning is lost.

That last scope case is worth knowing about: a token can be active, unexpired and still unable
to post, because LinkedIn invalidates every existing token when a *different* scope set is
requested. Renewing with a shorter list produces exactly that. **Tick the same three scopes
every time.**

Introspection uses the app's own credentials rather than the token's authority, which is what
makes it safe to run on a schedule — it can read a token's status and it cannot use it.

### One-time setup

1. **Create the app** at
   [linkedin.com/developers/apps/new](https://www.linkedin.com/developers/apps/new). The form
   asks for a LinkedIn **Page** to associate the app with, and this is where people get stuck:
   if you have none, make one for Indie Core Dev first — it takes a minute, and the app cannot
   be created without it. Then click **Verify** on the app's Settings tab, which opens a link
   you approve as the Page's own admin. That is you, so it is a click, not a wait.
2. **Add two products**, on the app's Products tab. Both are self-serve — they turn on
   immediately, with no review:

   | Product | Grants | Why this one |
   | --- | --- | --- |
   | Share on LinkedIn | `w_member_social` | posting |
   | Sign In with LinkedIn using OpenID Connect | `profile`, `email` | so the script can ask who the token belongs to |

   The second is the one people skip, because posting plainly does not need a sign-in product.
   Without it `/v2/userinfo` returns 403 and the script has no author URN — it says so and tells
   you to set `LINKEDIN_AUTHOR_URN` instead, which also works.
3. **Mint the token** with the
   [token generator](https://www.linkedin.com/developers/tools/oauth/token-generator): pick the
   app, tick `openid`, `profile` and `w_member_social` — **the same three every renewal** —
   approve the consent screen as yourself, copy the token. Leave `email` unticked; nothing here
   reads it. Tick the redirect-URL confirmation box: the tool adds its own callback URL to the
   app, which is why that box exists, and leaving it in place saves doing it again in 60 days.
4. **Add the repository secrets**, under Settings → Secrets and variables → Actions:

   | Secret | Required | What it is for |
   | --- | --- | --- |
   | `LINKEDIN_ACCESS_TOKEN` | yes | posting. Without it the workflow skips with a notice rather than failing |
   | `LINKEDIN_CLIENT_ID` | no | the token expiry warning. On the app's Auth tab |
   | `LINKEDIN_CLIENT_SECRET` | no | the same. Introspection only — it cannot post |
   | `LINKEDIN_AUTHOR_URN` | no | saves a `/v2/userinfo` call per run |

5. **Export the same token locally** for the dry run and for posting by hand:

   ```bash
   export LINKEDIN_ACCESS_TOKEN=...
   export LINKEDIN_AUTHOR_URN=urn:li:person:...   # optional, saves a lookup per run
   npm run linkedin
   ```

   The dry run needs no token at all — it exits before the token is read. So a clean dry run
   proves the script works and says nothing about whether the token does; `--check-token` or
   the [token inspector](https://www.linkedin.com/developers/tools/oauth/token-inspector)
   answers that without posting anything.

Repeat steps 3 and 4 when the token expires — nothing before them needs doing twice.

Posting to a **company page** rather than your own profile needs `w_organization_social`, which
is behind LinkedIn's Community Management API review. The script would do it with no change —
point `LINKEDIN_AUTHOR_URN` at the organisation URN — on a token that is not self-serve to get.

## Running it twice is safe, in a way dev.to's is not

A LinkedIn post cannot be meaningfully edited: the commentary can be patched, the link card
cannot. So there is no re-run that updates what is already there, and a second post is a
duplicate rather than an edit. `_source/linkedin.json` records the post URN for each slug and a
slug in it is skipped; it is written after every single post, so a run that dies halfway cannot
forget what it already put on the feed.

**That ledger is a tracked file.** Commit it on a branch after posting, like anything else here
— it is the only memory of what has gone out, and a fresh clone without it would re-post
everything.

`--force` posts a slug that is already recorded. There is no undo from here: the API can delete
a post, but the people who saw it still saw it.

## What the script does to the text

- **LinkedIn's `little` format is escaped.** `| { } @ [ ] ( ) < > # \ * _ ~` are all reserved,
  and all must be backslash-escaped even where they are obviously not markup — an unescaped `(`
  in a title does not render as a bracket, it fails the whole request. The dry run un-escapes
  the text again for display, because nobody can proofread a paragraph through backslashes.
- **`tags` become hashtags**, three at most, as the `{hashtag|\#|unity}` template LinkedIn
  wants rather than a literal `#unity`. Past three they read as a wall of blue and stop being
  seen at all.
- **The URL goes in the text as well as on the card.** The card is what people click; the text
  is what they copy when they quote the post somewhere else, and a quote without the link is a
  dead end.
- **The link card carries `public/assets/og/default.jpg`**, uploaded once and reused. A token
  scoped to `w_member_social` cannot read images back, so an upload cannot be verified before
  it is used — if LinkedIn rejects the post over the image, the script says so and re-posts
  without it rather than losing the post over its picture.
