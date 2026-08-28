# Build gates for a static site

Two dependency-free Node scripts that decide whether a build is allowed to ship. Run them
after your generator writes its output; wire them into CI so the deploy job depends on them.

```
npm run build && node verify.mjs && node lighthouse-check.mjs
```

Both exit non-zero on failure, which is the whole interface.

## Files

| File | What it does |
| --- | --- |
| `verify.mjs` | Walks the built output and fails on anything that must never ship |
| `lighthouse-check.mjs` | Fails if performance, accessibility, best-practices or SEO drop below budget |

## What verify.mjs checks

Every rule is here because something got past a review, not because a style guide recommends
it. Adapt the list; the shape is the point.

- **Head essentials** — `<title>`, meta description, an absolute canonical, an `og:image`
  that exists on disk. Warns when title or description will truncate in results.
- **Structure** — exactly one `<h1>` per page.
- **Links and images** — every site-absolute `href`, `src` and `srcset` candidate resolves to
  a real file. Every `<img>` has `alt`; missing `width`/`height` warns.
- **`target="_blank"`** without `rel="noopener"`.
- **Content hygiene** — double-escaped entities, placeholder copy, markup left over from a
  platform migration.
- **Redirects** — every target resolves, and every rule is a 301.
- **Sitemap** — canonical host, no dead URLs, and every built page is listed.

## What lighthouse-check.mjs does

Runs Lighthouse against a sample of URLs and fails the build below budget:

```
performance ≥ 90, accessibility ≥ 100, best-practices ≥ 100, seo ≥ 100
```

The one non-obvious part: **performance is re-measured when it misses, and the median is
taken.** Shared CI runners are noisy, and a gate that fails at random gets ignored, then
disabled, then deleted. Only performance is retried — the other categories are deterministic.

Override per-run with `LH_BUDGET`, e.g. `LH_BUDGET='{"performance":80}'`.

## Worth knowing

Write the failure messages for whoever — or whatever — has to fix them:

```
  ERROR  /blog/index.html: dead internal link → /games/word-slot
```

A message that names the page, the problem and the offending value can be handed straight to
a coding agent and fixed in one pass. "Validation failed" starts a conversation instead.

---

Written up in full here: **https://www.indiecore.net/blog/build-reviews-ai-code/**

_Generated from the live scripts — see the post for context._
