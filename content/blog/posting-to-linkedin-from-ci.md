---
title: Four things break when CI posts to LinkedIn
date: 2026-09-04
description: The LinkedIn API call that publishes a post is six lines. The token that expires every 60 days with no refresh, the read scope you cannot have, and a filename that became a dead link took the rest of the afternoon.
tags: [ci-cd, github-actions, linkedin]
keySections: [The app, and the Page you probably do not have, The token dies every 60 days and there is no refresh token, A filename became a link to a host that does not exist]
linkedin: true
linkedinText:
  - LinkedIn will let you post as yourself from a script in about twenty minutes. The four things that took the rest of the afternoon are the ones nobody writes about.
  - The access token expires every sixty days and there is no refresh token unless you are an approved partner. You cannot ask LinkedIn what you already posted, because the read scope is restricted while the write scope is self-serve. A published post cannot be re-run into place. And it turns anything shaped like a domain into a link without checking the domain exists, which is how a filename in my first automated post became a link to a host that will never resolve.
  - Written up with the setup that gets you there — the company Page you need before an app can exist, the verification step whose error message points somewhere else, and the second product almost everyone skips.
draft: false
---

I wanted every new blog post announced on LinkedIn without me remembering to do it. A
scheduled job, a line of frontmatter on the post, and nothing else.

The API call that publishes the post is six lines of JSON. Everything below is what took the
rest of the afternoon, and none of it appears on the happy path in the documentation.

## The part that goes the way you expect

Register an app in the LinkedIn developer portal, add the **Share on LinkedIn** product from
the Products tab, and you have `w_member_social` — permission to post as yourself. It is
self-serve. No review, no queue, no application form. Then:

```http
POST https://api.linkedin.com/rest/posts
Authorization: Bearer <token>
LinkedIn-Version: 202608
X-Restli-Protocol-Version: 2.0.0
```

```json
{
  "author": "urn:li:person:<id>",
  "commentary": "the text of the post",
  "visibility": "PUBLIC",
  "distribution": { "feedDistribution": "MAIN_FEED" },
  "content": { "article": { "source": "https://example.com/post/", "title": "…" } },
  "lifecycleState": "PUBLISHED"
}
```

You get a `201` and the post URN in the `x-restli-id` response header. That works first time.

Getting to the point where that call is possible took longer than writing it.

## The app, and the Page you probably do not have

Nothing in the developer portal works until an app exists, and an app cannot exist without a
LinkedIn **Page** to attach it to. The form will not take a personal profile. If you post
under your own name and have never run a company page, that is the wall you hit first, before
any code.

**1. Make the Page.** `linkedin.com/company/setup/new`, choose *Company*. It wants a name, a
public URL, a website, an industry, a company size, a logo and a description — and the
description has a **250 character minimum**, which is more than you think when the honest
answer is one line. Tick the box confirming you may act for the organisation.

Nothing about the Page needs finishing. It exists so the app has something to attach to, and
so that you can approve the app's verification as its admin in the next step. Mine has one
paragraph and a logo.

**2. Make the app.** `linkedin.com/developers/apps/new`. App name, the Page from step one, an
optional privacy policy URL, and a square logo of at least 100px. The form warns that the Page
association **cannot be undone once saved**, and it means it, so pick the right Page.

**3. Verify it.** Settings tab → **Verify**. It produces a link that a Page admin has to open
and approve. That admin is you, so this is a click rather than a wait — but until it is done
the Products tab hands you nothing, and the token generator will tell you there are no scopes
available for this app. That error message sounds like a permissions problem. It is this step.

**4. Add two products, not one.** The Products tab lists everything LinkedIn offers, most of
it behind an application form and a partner programme. Two of them are not. Each has a
*Request access* button, and for these two the word *request* is misleading — there is no
queue and nobody reads it. You click, you accept a terms dialog, and the product is on.

| Product | Grants | Why you need it |
| --- | --- | --- |
| Share on LinkedIn | `w_member_social` | create posts as yourself. This is the whole API surface used here |
| Sign In with LinkedIn using OpenID Connect | `openid`, `profile`, `email` | call `/v2/userinfo`, which answers with your member id |

The second one is the one that gets skipped, and skipping it is completely reasonable:
you are automating posts, not building a login button. Nothing about the name suggests you
need it.

What it actually gets you is your own identity. Every post body needs an `author` field
holding `urn:li:person:<id>`, and the only self-serve way to learn that id is
`/v2/userinfo`, which is an OpenID Connect endpoint and therefore lives with the sign-in
product. Without it that call returns 403 and you have no author. Add the product, or find
your member id once and hardcode it — both work, and the second means one fewer request per
run.

Check it landed before going further. The **Auth** tab has an *OAuth 2.0 scopes* panel: it
should list the scopes you just enabled. While it reads `No permissions added`, nothing else
in the portal will work, and the errors you get elsewhere will not mention this tab.

**5. Mint the token** in the portal's token generator. Pick the app and you get a checkbox per
available scope. Tick three:

- `w_member_social` — *"Create, modify, and delete posts, comments, and reactions on your
  behalf"*. The posting itself.
- `profile` and `openid` — what makes `/v2/userinfo` answer.

Leave `email` unticked. Nothing here reads it, and a token that can do less is a better thing
to leave sitting in a CI secret.

There is also a checkbox confirming the tool will update your app's redirect URL settings.
Tick it. The generator adds its own callback URL and runs the whole OAuth round trip in the
browser for you, which is why this flow needs no redirect URL of your own, no client secret,
and no local server to catch a code. Leave that callback URL in place afterwards; you will be
back in sixty days.

Approve the consent screen as yourself, copy the token, and that is the credential your CI
job needs. Tick the same three scopes at every renewal — a shorter list invalidates the token
you already have, and the section below is about why that is worse than it sounds.

## The token dies every 60 days and there is no refresh token

Every LinkedIn access token comes back with `"expires_in": 5184000`. Sixty days. The
[documentation on refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)
is one sentence long on who can have them: approved Marketing Developer Platform partners. An
ordinary app never sees a `refresh_token` field in the response. This is a decision, not a
setting you have missed.

So any unattended pipeline built on this breaks six times a year, and no amount of workflow
design changes that. What the design decides is *how* it breaks.

The failure I care about is not a red job. A red job I will see. The failure is a green job
with nothing in it, on the morning a post was due — the run succeeds, finds a token it
cannot use, and reports success at having done nothing.

So the token check runs first, on every run, before the job looks at whether there is even
anything to post. A quiet day is exactly when a dead token goes unnoticed:

```bash
curl -X POST 'https://www.linkedin.com/oauth/v2/introspectToken' \
  -d 'client_id=…' -d 'client_secret=…' -d 'token=…'
```

```json
{ "active": true, "status": "active", "expires_at": 1762... ,
  "scope": "openid,profile,w_member_social" }
```

Introspection takes the app's own credentials rather than the token's authority, so a
scheduled job can read a token's status without being able to use it. Under fourteen days
left, my job prints a warning. Expired or revoked, it fails outright and posts nothing.

One thing a date comparison misses. A token can be active, unexpired, and still unable to
post, because LinkedIn invalidates every existing token when you request a different scope
set. Renew with a shorter list of ticked boxes than last time and you get exactly that: a
valid token that 403s on the only call you wanted. Check the `scope` string in the
introspection response, not only `active`.

## You cannot ask LinkedIn what you already posted

The obvious way to make a posting job safe to re-run is the way I built the dev.to
cross-poster: fetch what is already on the account, match it, skip or update.

Reading your own posts needs `r_member_social`. The permissions table describes it as
restricted and available to approved users only, alongside the self-serve write scope that
sits directly above it. You can write to the account and you cannot read it back.

That has one consequence worth stating plainly: the only record of what you have posted is
the one you keep. I keep a JSON file in the repo mapping post slug to the returned
URN, and the CI job commits it back to the default branch after a run. It is written after
every single post rather than at the end of the run, because a job that dies halfway must not
forget what it already put on a public feed.

That file being committed by a machine is the second exception in this repo to a rule I
otherwise hold to — never commit to the default branch. It earned the exception. Without it,
every scheduled run re-posts the entire backlog.

## A post cannot be re-run into place

The dev.to cross-poster is idempotent in the strong sense: articles are matched by their
canonical URL, so a second run edits the article the first run made. Running it twice is free,
and a mistake is one re-run away from fixed.

LinkedIn gives you half of that. The `commentary` field can be patched. The link card attached
to the post cannot. There is no version of "run it again and it converges".

Three things followed from that, and all three are the opposite of how I built the dev.to job:

- **No push trigger.** A commit landing on the default branch must not put anything on a feed
  by itself.
- **A cap of one new post per run.** Not an API limit — LinkedIn allows around 150 requests
  per member per day, and a post costs about four. It is a feed limit. Past roughly one a day
  the reach of each one drops, and a burst of daily self-links to one domain reads as
  automation whether or not it is.
- **A confirmation prompt when a human is present**, and an explicit flag when one is not, so
  an unattended post is always something a config file asked for.

## A filename became a link to a host that does not exist

The `commentary` field is not plain text. It is a format LinkedIn calls `little`, and it
reserves fourteen characters — ``| { } @ [ ] ( ) < > # \ * _ ~`` — every one of which must be
backslash-escaped even where it is obviously not markup. An unescaped `(` in a title does
not render as a bracket. It fails the whole request. Hashtags are a template rather than a
literal, so `#gamedev` is sent as `{hashtag|\#|gamedev}`.

I got all of that right, and shipped a bug anyway.

My first automated post contained the word `mainTemplate.gradle`, in a sentence about reading
Android build logs. LinkedIn published it as a hyperlink to `http://maintemplate.gradle/` — a
host that does not exist and never will. It autolinks anything shaped like a domain and does
not check that the domain resolves.

There is no fix inside the format. Dots are not escapable. A zero-width character between the
name and the extension would break anyone copying the text. The only fix is to not write the
token, so the check I added scans the composed text, strips real URLs first, allows my own
domain, and refuses to publish when anything domain-shaped survives:

```
LinkedIn would publish these as links to hosts that do not exist:
  unity-gradle-build-failed-is-not-the-error: mainTemplate.gradle
Rewrite them without the dot — "a mainTemplate gradle file". Nothing was posted.
```

Refused rather than warned about. A warning on a step nobody watches is how the first one
shipped.

## The order to do it in

If you are starting this tomorrow, this is the sequence that would have saved me the
afternoon. All of it is free — no paid tier, no partner programme, no approval queue.

1. Create a LinkedIn Page. You need one before an app exists, and the description wants 250
   characters.
2. Create the app against that Page, then verify it from the Settings tab. An unverified app
   offers no products, and the error you get instead points at permissions.
3. Add both products: Share on LinkedIn, and Sign In with LinkedIn using OpenID Connect.
4. Mint a token in the portal's generator with `openid`, `profile` and `w_member_social`.
   Write those three down somewhere; you need the identical set at every renewal.
5. Post one thing by hand first, with a confirmation prompt, before any of it runs unattended.
   The request body is the easy part to get right and the easy part to get wrong.
6. Then, and only then, the guards: token introspection before anything else in the run, a
   ledger written after every post, no push trigger, and a scan for domain-shaped words.

## What I would tell someone starting this tomorrow

The posting call is the easy part and you will have it working in twenty minutes. Budget the
afternoon for the other four: a credential that expires six times a year with no way to renew
it in code, a read permission you cannot have, a publish operation with no undo, and a text
format with a rule about dots that is documented nowhere.

If you only build one guard, build the token one. Everything else fails loudly on its own.
That one fails silently, and it fails on the exact day you had something to say.
