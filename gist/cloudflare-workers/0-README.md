# Static site → Cloudflare Workers, with gated deploys

A GitHub Actions pipeline that builds a static site, refuses to ship it if the checks fail,
and deploys it to Cloudflare Workers. Free tier throughout.

```
git push
   └─ build ──► verify ──► Lighthouse budget ──► deploy
```

`deploy` depends on the checks, so nothing broken reaches the internet. Pull requests get a
preview URL posted as a comment; merges to `main` go to production.

## Files

| File | What it is |
| --- | --- |
| `wrangler.jsonc` | The Worker: static assets, custom domains, 404 handling |
| `ci-cd.yml` | Goes in `.github/workflows/` |

## Setup

1. Create a Worker: **Workers & Pages → Create → Workers → Upload assets**, name it, drag
   your build output in once to create the project.
2. Create an API token from the **"Edit Cloudflare Workers"** template — not a custom one,
   and not the Global API Key. Scope it to your account and zone.
3. Add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Create `production` and `preview` environments; restrict `production` to `main`.
5. Replace `my-site` and `example.com` throughout, then push.

## Things that will bite you

- **`workers_dev` and `preview_urls` must be set explicitly.** Absent from the config means
  *disabled*, which silently takes your `*.workers.dev` URL offline and stops preview URLs
  being generated.
- **Custom domains belong in `routes`, not the dashboard.** The dashboard dialog matches zone
  names rather than hostnames, so a subdomain can't be selected there.
- **Attaching a custom domain fails while an old DNS record exists** for that hostname —
  `already has externally managed DNS records [code: 100117]`. Delete the old record first.
- **Don't connect a Git repository in the Worker's settings** if you use this workflow. That
  enables Cloudflare's own builds, and two pipelines then race to publish the same site — one
  of them without any checks.
- **Non-overlapping `_headers` rules.** Every matching rule is applied and the values are
  joined, so a broad `/assets/*` beside `/assets/images/*` produces a `Cache-Control` with
  two `max-age` values. Browsers take the first.

## Not included

`scripts/verify.mjs` and `scripts/lighthouse-check.mjs` are referenced by the workflow but
are specific to each site. There is a companion gist for those — linked from the post below.

---

Written up in full here: **https://www.indiecore.net/blog/static-site-cloudflare-workers/**

_Generated from the live configuration — see the post for context._
