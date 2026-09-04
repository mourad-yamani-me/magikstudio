---
title: Changing a Google Play privacy policy URL
date: 2026-08-30
description: Five live listings pointed at my old Blogger URLs. How I moved them without ever serving a broken privacy policy link.
tags: [google-play, privacy, hosting, seo]
devto: true
linkedin: false
draft: false
---

Every app I have on Google Play carries a privacy policy URL in its listing. For a long time
those URLs pointed at a Blogger site, because that is where I had written them, and Blogger
was free and I had no reason to think about it again.

Then I moved the domain to Cloudflare, and had to think about it quite a lot.

The thing that makes this different from any other link on the internet is who is checking
it. A dead link on your own site costs you a reader. A dead **Google Play privacy policy
link** is a listing that no longer satisfies the User Data policy, on five apps at once, and
you find out about it from a policy notice rather than from your analytics. The URL is not
content. It is a dependency of the store listing, and it is owned by whoever controls that
path — which for a few days was going to be me, halfway through a DNS change.

## What the URL actually has to do

The requirements are less interesting than people expect, and the boring one is the one that
bites:

- **Reachable by anyone.** No login, no geo-block, no interstitial.
- **Not user-editable.** A shared Google Doc that anyone with the link can edit does not
  count as a policy document.
- **About the app, and specific.** It has to name who is responsible for the data and what
  happens to it. Mine name the controller, the legal basis under Article 6(1), the Article
  15–22 rights and the CNIL as supervisory authority, because I am in France and that is what
  the GDPR asks for.
- **Still reachable next month.** Nothing in the console re-checks this on a schedule you
  control. The URL you typed in once is the URL that is expected to answer, indefinitely.

That last one is the whole problem with moving hosts. The other three are satisfied the day
you write the document.

## The order of operations that cannot break

There is an obvious sequence — change the pages, then go and update the **Google Play store
privacy policy URL** in five listings — and it has a window in it. Between the DNS cutover
and the last listing edit, the old paths are gone and the new ones are not in the console
yet. It is probably a short window. It is a window on a legal document that a policy reviewer
could look at.

So I inverted it. The old URL never stops working, and the listing edit stops being urgent:

1. **Publish the new pages first**, at the new paths, on the new host. Nothing points at them
   yet, which is fine.
2. **Keep every old path alive as a 301** to its new home. This is the step that removes the
   deadline.
3. **Verify both**, from outside, before touching anything in the console.
4. **Then update the listing URL** — at leisure, one app at a time, with no window anywhere.

Here is what the redirect map looks like in my case. The left column is Blogger's page URL
scheme, which I did not choose and cannot change; the right is where the policy lives now:

```
/p/privacy-policy-for-word-slot.html          /privacy/word-slot/                 301
/p/privacy-policy-for-soda-jam-color-sort.html /privacy/soda-jam-color-sort/      301
/p/privacy-policy-for-gridsmash-block.html    /privacy/color-block-puzzle-master/ 301
```

Note the third line. The Blogger URL says `gridsmash-block` and the game is now called Color
Block Puzzle Master. The old path is a fossil of a name I stopped using, and it still has to
resolve, because it is the string sitting in a store listing I filed years ago. That is the
normal condition of these URLs and the reason renaming one is a store problem rather than a
tidy-up.

## How to change the privacy policy URL in Google Play Console

Once the redirect is live, the console part is dull, which is the goal. Per app: **Policy →
App content → Privacy policy → Manage**, paste the new URL, save. Repeat for each app. The
change takes effect on the listing without a new release, and the form is the same one you
filled in when you first published.

Two things worth knowing before you paste. The field is per app, not per developer account,
so five apps means five edits — there is no bulk action. And the URL you enter is the one
reviewers will open, so open it yourself first, in a private window, on mobile data rather
than on your own network. Every "**google play console update privacy policy url**" problem I
have read about turns out to be a page that was fine on the author's laptop and behind a
staging password for everyone else.

## Making the redirect impossible to forget

Anything I have to remember to do, I eventually do not do. The redirect list is generated
from the same array that generates the pages, so a game cannot exist with a policy page and
no redirect:

```js
{ key:'word-slot', slug:'word-slot', legacy:'privacy-policy-for-word-slot', … }
```

One entry, three outputs: the policy route, the games page and the 301. Adding the sixth game
was one line, and the legacy path came along with it without my thinking about it. The build
also refuses to finish if the legal page loses the controller name, the Article 6(1) basis,
the Article 15–22 rights or the CNIL reference — those are exactly the parts a well-meant
edit for tone would quietly delete.

The verification is a loop over the old URLs, run against the live site rather than the
build output:

```bash
curl -sIL https://www.indiecore.net/p/privacy-policy-for-word-slot.html \
  | grep -iE 'HTTP|location'
# expect: HTTP/2 301  +  location: /privacy/word-slot/
```

Run it after the DNS change, not before. Before the cutover you are testing the old host, and
it will pass for the wrong reason.

## What I would do differently

I would put the redirects in on the *first* day, before I had any intention of moving. They
cost nothing while the old host is still serving, and they mean the migration has no ordering
requirement at all.

And I would write down, next to the code, that these URLs are load-bearing. I did that in the
end — the repo's conventions file now says the privacy paths are referenced from Play Console
listings and that a route may move only if it keeps a 301 — but I wrote it after the move,
which is the wrong order for a note whose entire job is to stop a future me from being
casual with a folder name.

## Takeaway

- The **google play privacy policy link** in a listing is a dependency, not a link. Treat a
  change to it like a change to an API someone else calls.
- Ship the redirect before the move, not after. It converts a deadline into a task.
- Verify from outside your own network, after the DNS change, per URL.
- Generate the redirect from the same source as the page, so the two cannot drift.
