---
title: Deploying a static site to Cloudflare Workers
date: 2026-08-26
description: A build-verify-deploy pipeline on Cloudflare's free tier, and the five traps that cost me an evening — including one that silently takes your staging URL offline.
tags: [cloudflare, ci-cd, github-actions, hosting]
code: https://gist.github.com/IndieCoreDev/11369ffb01a68f04f0bfc9f803922b17
codeLabel: Both files, ready to copy
devto: true
linkedin: false
draft: false
---

I moved this site off a hosted blogging platform onto Cloudflare, with GitHub Actions doing
the building and Cloudflare doing the serving. It costs nothing, deploys in about two and a
half minutes, and refuses to publish anything that fails its checks.

Getting there took longer than it should have. Here is the setup, and the five things that
tripped me up — none of which are obvious from the documentation.

## The shape of it

```
git push
   └─ GitHub Actions
        ├─ build          generate the site
        ├─ verify         dead links, missing images, bad metadata, broken redirects
        ├─ Lighthouse     fail if performance/accessibility/SEO drop below budget
        └─ deploy         upload to Cloudflare
```

The important part is that **deploy depends on the checks**. A broken build never reaches
the internet. Pull requests get a preview URL; merges to `main` go live.

The triggers and permissions that make that safe:

{{gist:ci-cd.yml#head}}

`permissions: contents: read` at the top means every job starts with the minimum, and only
the one that comments on pull requests gets more. The `concurrency` block cancels superseded
runs on a branch but never interrupts a production deploy.

## Trap 1: "Upload assets" gives you a Worker, not Pages

Cloudflare has two products that host static sites: **Pages**, the older one, and **Workers**,
the current one. Their dashboard now puts the *Upload assets* button under Workers.

So you follow a guide that says "create a Pages project", you click the obvious button, and
you end up with a Worker. Your site is live at `something.workers.dev`, and the
`something.pages.dev` address every tutorial tells you to visit returns:

```
DNS_PROBE_FINISHED_NXDOMAIN
```

Nothing is broken. You simply never created a Pages project.

**Both products work.** Workers is the one Cloudflare is investing in, and it supports
everything a static site needs — I verified each of these on a live deployment:

| Feature | Workers static assets |
| --- | --- |
| `_redirects` | yes |
| `_headers` | yes |
| Custom 404 page | yes |
| Custom domains | yes, if the nameservers are Cloudflare's |

Pick Workers and stop worrying about `pages.dev`.

## Trap 2: the API token needs the right template

To deploy from CI you create a scoped API token. The obvious move is to build a custom one
with a single permission. Don't.

A Worker deploy needs several permissions working together — Workers Scripts, plus read
access to account and user details. Miss one and you get:

```
Authentication error [code: 10000]
```

which tells you nothing about which permission is absent. Use the built-in
**"Edit Cloudflare Workers"** template instead; it ticks exactly the right boxes. Scope it to
your account and your zone, and give it an expiry.

If you already made a *Cloudflare Pages · Edit* token because you thought you were using
Pages, it will not deploy a Worker.

Test it before wiring it into CI:

```bash
export CLOUDFLARE_API_TOKEN=...
npx wrangler whoami
```

Ten seconds, and it prints the permissions it actually has.

## Trap 3: wrangler turns things off when you're not looking

This one cost me the most time. Once you add a `wrangler.jsonc`, that file becomes the
complete description of your Worker — and **anything absent from it is treated as disabled.**

Deploy with a minimal config and you get:

```
▲ [WARNING] Because 'workers_dev' is not in your Wrangler file,
  it will be disabled for this deployment by default.

▲ [WARNING] Because your 'workers.dev' route is disabled and your
  'preview_urls' setting is not in your Wrangler file, Preview URLs
  will be disabled for this deployment by default.
```

Two warnings among the normal output, and easy to skim past. The result: my staging URL
started returning 404, and per-version preview URLs stopped being generated — which would
have silently broken pull request previews, since the CI job reads the preview URL out of
`wrangler versions upload`.

This is the job that publishes a preview per pull request, and reads the URL back out of
wrangler's output:

{{gist:ci-cd.yml#preview}}

A dashboard-created Worker has both on by default. Writing a config turns them off. Say so
explicitly — this is the whole config this site runs on:

{{gist:wrangler.jsonc}}

`not_found_handling: "404-page"` serves your `404.html` with a real 404 status.
`auto-trailing-slash` makes `/about/` resolve to `about/index.html`.

## Trap 4: the Custom Domain dialog matches zones, not hostnames

Adding `www.example.com` through the dashboard gave me:

```
No zones match www.example.com.
```

I own the domain. `www` is a subdomain of it, covered by the same zone. But the dialog was
matching against zone names — typing `example.com` found it, typing `www.example.com` found
nothing.

The error offers a helpful-looking link to "add the domain to Cloudflare". **Do not click
it.** That wizard creates a *separate zone* for `www.example.com` and offers to import DNS
records into it. You would end up with two overlapping zones and a genuine mess.

The fix is to skip the dashboard. Those `routes` entries above create the custom domains and
their DNS records on deploy, and re-assert them every time — so the configuration can't drift.

One thing to know: attaching fails while an old record is in the way.

```
Hostname 'example.com' already has externally managed DNS records (A, CNAME, etc).
Delete them first or try a different hostname. [code: 100117]
```

Delete the old records for that hostname, then deploy again.

## Trap 5: overlapping `_headers` rules concatenate

Cache headers looked right in my config:

```
/assets/images/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=86400
```

What actually came back over the wire:

```
cache-control: public, max-age=86400, public, max-age=31536000, immutable
```

**Every matching rule is applied and the values are joined.** An image matches both, so it
gets two `max-age` values in one header. Browsers take the first — 1 day — and the year-long
immutable cache silently does nothing.

I only caught it because I curled the response headers after deploying. Make the rules
non-overlapping:

```
/assets/images/*
  Cache-Control: public, max-age=31536000, immutable

/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/assets/app.js
  Cache-Control: public, max-age=86400
```

## If your domain also handles email

This is the part that makes people nervous, so it's worth being plain about it.

Your domain has two independent groups of records:

- **Email** lives in `MX` and `TXT` records (SPF, DKIM)
- **Website** lives in `A` and `CNAME` records

Mail servers only read the first group. Browsers only read the second. **Repointing your
website cannot affect mail delivery.** The only way to break email is to delete an `MX` or
`TXT` record by hand.

So: change records one at a time, never use a bulk delete, and if a screen offers to remove
`MX` or `TXT` records, say no. Take a zone export first — Cloudflare has an *Export records*
button — and check afterwards:

```bash
dig +short MX example.com
dig +short TXT example.com | grep spf
```

Then send a real test email. DNS looking correct is not the same as mail flowing.

## One deployment system, not two

The Worker's settings page offers to connect a Git repository. If you are deploying from
GitHub Actions, **leave it empty.**

Connecting it enables Cloudflare's own build system, and you end up with two pipelines
publishing the same site: yours, which runs checks, and Cloudflare's, which doesn't. They
race, and whichever finishes last wins. A build your pipeline correctly refused to ship can
get published anyway.

GitHub pushes to Cloudflare. Cloudflare never pulls.

## Worth doing while you're in there

- **Verify the deploy actually landed.** Change something with a visible fingerprint — a
  header, a version string — and `curl` for it. "The deploy succeeded" and "the new build is
  serving" are different claims.
- **Redirect old URLs, don't drop them.** A `_redirects` file with `301` lines preserves
  search ranking and keeps any link you've published elsewhere working.
- **Budget your Lighthouse scores in CI.** A number that only gets checked when you remember
  to check it will drift.

None of this is exotic. It is a static site on free hosting. But the gap between "it
deployed" and "it deployed correctly, and nothing else broke" is where the evening goes.
