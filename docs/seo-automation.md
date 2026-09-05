# SEO automation

Two workflows, doing two different jobs.

| Workflow | Script | When | What it is for |
| --- | --- | --- | --- |
| **SEO ping** | `scripts/seo-ping.mjs` | after each production deploy, and Mondays | Announce the live URL set. Report the current state. |
| **SEO watch** | `scripts/seo-watch.mjs` | daily, 06:17 UTC | *Remember* the state, and raise what changed. |

Both cover **two engines**. Google answers through Search Console, Bing through
the Webmaster Tools API, and each keeps its own half of the ledger. They are
never averaged into one number: a page Google has indexed and Bing has never
fetched is the single most useful row in the report, and a combined score is
exactly what would hide it.

The split is the whole idea. A ping answers "what does Google think right now",
and that answer evaporates when the run ends — so the two facts that matter most
are invisible to it: a page that **used to be** indexed and is not any more, and
a query that **used to** rank on page one. A regression only exists relative to a
previous observation, so the watcher keeps one.

## The ledger

`_source/seo-watch.json`, committed, for the same reason `content/blog/topics.json`
is committed: the record of what was observed is the product, not a snapshot of
today. No database and no external store — a JSON file in the repo, diffable in
review, readable by anything.

Each run observes, compares against the previous run, and then:

- **opens** a finding for anything that got worse or is worth acting on,
- **keeps** one that is still true, updating its detail,
- **resolves** one whose condition no longer holds, with the date.

Nothing accumulates that has stopped being true, so the open list stays short
enough to act on. A finding is only resolved if the source that produces it
actually ran — a skipped or failed query proves nothing, and must not be read as
good news.

Findings carry stable ids, so a re-run updates rather than duplicates one, and
so you can close it by hand once the work is done:

```sh
npm run seo:watch -- --brief                     # the open list, with fixes
npm run seo:watch -- --close=near-miss:foo --note="rewrote the title"
npm run seo:watch -- --wontfix=stale-crawl:bar --note="page is deliberately static"
```

### What it looks for

| Finding | Means | The fix it implies |
| --- | --- | --- |
| `deindexed` | Was `PASS`, no longer is | Real regression. Check 200, sitemap, `noindex`, then request indexing by hand. |
| `never-crawled` | In the sitemap 14+ days, never fetched | A discovery problem — link to it from a page Google crawls often. Not a submission problem. |
| `stale-crawl` | Indexed, not crawled in 90 days | Usually fine. Only matters if the content changed and the old version still ranks. |
| `sitemap-errors` / `-warnings` | Search Console rejects entries | Open the Sitemaps report for the per-URL reason. |
| `position-slip` | Lost 3+ positions on 20+ impressions | Something now outranks it. Compare and find the section it is missing. |
| `near-miss` | Position 5–20 on 20+ impressions | The one case where a sharper `<title>` and description actually moves the number. |
| `zero-click` | 50+ impressions, no clicks | Shown and not picked — the title does not match the intent, or the position is too low to see. |
| `bing-coverage` | Bing has crawled less than half the sitemap | One site-level row instead of thirty identical ones. Normal for a new property; act if it has not moved in a month. |
| `bing-not-indexed` | Bing has no crawl record for a page, and most others are fine | The one case where Bing's manual submission quota is worth spending — Google has no equivalent to spend. |
| `bing-crawl-issue` | Bing hit a redirect, a 4xx/5xx, or a robots block | Named per issue. The only finding here sourced from an engine's own crawl errors rather than inferred. |

Each rule earns its place by implying a *different* fix. A finding you would act
on the same way as its neighbour is noise, and noise is what makes a report stop
being read — see `AGENTS.md`, "How to add a check".

That rule is why there is no `bing-near-miss` or `bing-position-slip`. Bing's
query stats are read and recorded, and they show up in the run summary, but a
Bing near-miss would ask for the same title rewrite the Google one already asks
for. Two findings, one fix, twice the noise. The data is in the ledger for the
day a Bing-only fix exists.

## The ledger is committed to `main` by a bot

This is the single sanctioned exception to "never commit to `main`" in
`AGENTS.md`. It is one machine-written file that is never part of `dist/`, and a
daily pull request nobody reads would be worse than the exception. The push
trigger in `ci-cd.yml` ignores that path, so a ledger commit never redeploys the
site and never re-triggers the ping through `workflow_run`.

Everything the findings ask you to *change* still goes through a branch and a PR,
like any other change. The watcher only observes and records; it never edits the
site.

## What is real and what is folklore

| Approach | Status |
|---|---|
| `google.com/ping?sitemap=…` | **Dead.** Google removed it in June 2023. Any guide still recommending it is stale. |
| Google **Indexing API** | **Not applicable.** It only accepts `JobPosting` and `BroadcastEvent` pages. Submitting anything else breaks Google's terms and is ignored either way. |
| Search Console API `sitemaps.submit` | Supported. This is the only automatable nudge Google still offers. |
| Search Console API `urlInspection` | Supported. Tells you per URL whether Google has it indexed. |
| **IndexNow** | Supported by Bing, DuckDuckGo, Yandex and Copilot. Instant, no credentials. Google does not participate. |
| Bing **SOAP / POX** APIs | **Dead.** Retired 31 August 2026. |
| Bing **JSON/HTTP** API | Supported, and it is the *migration target* for the line above — not a casualty of it. Same key, same quotas, same method names. |
| `bing.com/ping?sitemap=…` | **Dead**, and superseded by IndexNow, which this repo already uses. |
| Bing **URL submission** | Supported, 100/day and 3000/month. Not rationed for scarcity — just redundant, because IndexNow already announced the same URLs for free. |

Set expectations accordingly. Sixteen URLs, a sitemap linked from `robots.txt`
and a crawlable site means Google already knows every page exists. Pinging
harder does not create demand. The genuinely useful output here is the
**index-status table**, which distinguishes two very different problems:

- URLs not indexed → a discovery or quality problem, worth fixing.
- URLs indexed with no traffic → a ranking or demand problem. No submission
  API touches that; it needs content people are actually searching for.

### Bing throttles per-URL lookups, so the watcher rotates

`GetUrlInfo` answers for one URL at a time, and Bing throttles it hard. Measured
against the live API, not inferred from the docs, which do not mention a limit:
**exactly ten calls succeed and the eleventh is refused** with `ErrorCode 5,
ThrottleHost`, and spacing them three seconds apart does not raise that. It is a
budget per window rather than a rate, so slowing down buys nothing. The block
also outlasts the burst — once tripped, calls keep failing for a couple of
minutes.

So `seo-watch.mjs` checks a **rotating slice** each run: longest-unchecked
first, ten by default (`--bing-urls=N`) because ten is what the budget allows,
sequential and spaced, stopping the moment Bing throttles so the remainder rolls
over to tomorrow. At 38 URLs the whole sitemap comes round about every four
days.

This works because the ledger already exists. Index membership shifts over
weeks, so a URL revisited every few days is sampled far more often than it
changes, and the accumulated record answers a question no single run can. The
findings read that accumulated state rather than the current slice, and count
only URLs Bing has actually been asked about — a URL never checked is an
absence of evidence, not evidence of absence.

The Google half needs none of this: Search Console allows 600 inspections per
minute, so it checks all 38 every run, five at a time.

### The Bing retirement headline is a trap

Searching for "Bing Webmaster API retirement" returns a wall of posts announcing
that the API died on 31 August 2026. What died is **SOAP and POX**. The
JSON-over-HTTP endpoint this repo calls is the REST API those posts tell you to
migrate *to*, and Microsoft's own notice says the key, the quotas and every
method carry over unchanged.

It is written down here because the failure mode is a careful person deleting a
working integration for good reasons. `scripts/bing-api.mjs` repeats it at the
top of the file, where someone about to change the endpoint will actually be.

## IndexNow

Works out of the box, no setup. The key lives in `_source/indexnow-key.txt`,
`build.mjs` copies it to `dist/<key>.txt`, and `scripts/verify.mjs` fails the
build if the two ever drift. The key is public by design — it authorises
submissions only while it is readable at that exact URL on that exact host.

To rotate it, put a new 8–128 character hex string in `_source/indexnow-key.txt`
and deploy. Nothing else references it.

## Bing Webmaster Tools — one-time setup

Shorter than the Google one: no service account, no IAM, one key.

1. Verify the site at [Bing Webmaster Tools](https://www.bing.com/webmasters).
   Importing from Search Console is the least work and needs no token on the
   site — which matters here, because `dist/` is generated and CI-only, so a
   pasted `msvalidate.01` meta tag or a `BingSiteAuth.xml` upload has nowhere to
   live. If you do want one of those, it has to be emitted from `build.mjs`.
2. **Either host will do.** Bing normalises `www` and the apex into one site:
   a property registered as `https://indiecore.net/` answers for
   `https://www.indiecore.net/` URLs, which is why the UI says "Site already
   added" if you try to add the second one. Confirmed against the live API —
   `GetUrlInfo` for a `www` URL returns a real crawl record under the apex
   property, and the `www` sitemap registers against it. This is the opposite
   of Search Console, where the two really are separate properties, and the
   difference is worth knowing before you go hunting for a bug.
3. *Settings* → *API access* → *API key*, and copy it. The key is
   account-level, not per-site.
4. In the repo → *Settings* → *Secrets and variables* → *Actions*, add secret
   **`BING_API_KEY`**.

Then check it locally before trusting a workflow to it:

```sh
export BING_API_KEY=...
npm run seo:bing -- --dry-run     # resolves the property, sends nothing
```

That prints which sites the key can see. Either host is fine; the scripts match
on the registrable domain and use whichever string Bing actually stores. The
warning only fires if the one registered property is a different domain
altogether, which means the key belongs to someone else's site.

The key is not needed for Bing to hear about new pages: IndexNow already does
that, with no credentials, and keeps doing it if this is never set up. What the
key buys is the answer coming back.

## Yandex Webmaster — the ownership token

The token lives in `_source/yandex-verification.txt` and `build.mjs` puts it on
the home page as `<meta name="yandex-verification" content="…">`. Pick the
**Meta tag** method in Yandex Webmaster; the token is the same string whichever
tab is showing.

**Not the root file**, which is the method Yandex offers first. It was tried and
reverted: the file was correct in `dist/`, and production still answered

```
GET /yandex_<token>.html   307 → /yandex_<token>
GET /yandex_<token>        200   Verification: <token>
```

because `html_handling: "auto-trailing-slash"` in `wrangler.jsonc` strips `.html`
from every URL on this site — the rule that gives the pages their clean paths.
Yandex fetches the exact `.html` address and wants a 200 there. Nothing local
could have caught it: `verify.mjs` reads `dist/`, where the file was right, and
the asset server is what rewrites the URL. Serving that one path would mean
giving an assets-only Worker a `main` script and a `run_worker_first` rule, for
one URL that a meta tag replaces.

So `verify.mjs` checks the home page carries the tag. Nothing else reads the
token: IndexNow already tells Yandex about new pages without it, and what
verifying buys is the index and query reporting coming back. Verification is
read from the live site, so deploy before pressing *Check*.

## Google Search Console — one-time setup

This is the part you have to do by hand once. IndexNow needs none of it, and the
Google half of **SEO ping** stays skipped until the secret exists — but **SEO
watch** is Search Console only, so it does nothing at all until step 5 is done.

1. In [Google Cloud Console](https://console.cloud.google.com), create (or
   pick) a project and enable the **Google Search Console API**. Any existing
   project is fine — the project is only a container for the enabled API and the
   service account object, and grants no access to anything by itself. Enabling
   the API does not affect whatever else that project does, and the load here is
   about 27 calls a day against a per-property limit of 2,000.
2. Create a **new service account** — do not reuse one that already exists in a
   shared project. No project roles are needed: its access comes from Search
   Console, not IAM, and a fresh account starts with none. That matters because
   this key ends up in GitHub Actions secrets, so it must not inherit whatever
   the project's other service accounts are allowed to do, and it has to be
   revocable on its own. A purpose-named address also explains itself later,
   when something has to answer why it owns the property.
3. Create a **JSON key** for it and download the file.
4. In [Search Console](https://search.google.com/search-console), open the
   property → *Settings* → *Users and permissions* → *Add user*. Paste the
   service account's `client_email` and grant it **Owner**.
   - `sitemaps.submit` only needs Full. **URL inspection requires Owner** — with
     Full it returns 403 and the index-status table will not render.
5. In the repo → *Settings* → *Secrets and variables* → *Actions*, add secret
   **`GOOGLE_SERVICE_ACCOUNT_JSON`** containing the entire JSON file, verbatim.
6. Only if the property is a *Domain* property rather than a *URL prefix* one,
   also add repository **variable** `GSC_SITE_URL` = `sc-domain:indiecore.net`.
   The default assumes the URL-prefix property `https://www.indiecore.net/`.

Then run each workflow by hand once — *Actions* → *SEO ping* → *Run workflow*,
and the same for *SEO watch* — and read the job summaries.

The first watch run opens findings for everything already true today and creates
`_source/seo-watch.json`. It cannot report a *change* yet: there is nothing to
compare against until the second run. That is expected, not a fault.

## Running it locally

```sh
npm run seo -- --dry-run          # resolve everything, send nothing
npm run seo -- --no-google        # IndexNow only
npm run seo                       # the real thing

npm run seo:bing                  # Bing only — the one to run when setting the key up
npm run seo:bing -- --dry-run     # ...resolving everything and sending nothing
npm run seo -- --no-bing          # skip the Bing step
npm run seo -- --submit-urls      # spend Bing's manual quota on the whole URL set

npm run seo:watch                 # observe, compare, update the ledger
npm run seo:watch -- --brief      # just the open findings — no network, no credentials
npm run seo:watch -- --dry-run    # observe and report, write nothing
npm run seo:watch -- --bing-urls=25   # check more URLs per run, if the throttle allows
```

`--brief` reads the committed ledger and touches nothing else, so it works
offline and without credentials. That is the one to run when you want to know
what to do next.

It reads the **live** sitemap, never `dist/`, so a deploy has to have landed
first. A dry run before the first deploy correctly reports that the IndexNow
key file is not being served yet.

## Failure modes

| Symptom | Cause |
|---|---|
| `is not serving the key (deploy first)` | `dist/<key>.txt` has not shipped. Deploy, then re-run. |
| Sitemap step 403 | The service account is not a user on the property, or `GSC_SITE_URL` names a property it cannot see. |
| Index status 403 | The service account has Full, not Owner. |
| IndexNow 422 | A submitted URL is not on `www.indiecore.net`. Check the sitemap's host. |
| `GOOGLE_SERVICE_ACCOUNT_JSON is not set` | SEO watch is Search Console only. Do the setup above. |
| `--brief` says "No ledger yet" | No successful watch run has landed. Run one. |
| Watch finds nothing on the first run | Correct — there is no previous observation to compare against yet. |
| `ERROR!!! InvalidApiKey` | `BING_API_KEY` is wrong or was re-issued. Settings → API access. |
| `ERROR!!! ThrottleHost` | Expected, and handled. The watcher stops and resumes tomorrow. Only worth investigating if no URL is ever checked. |
| `URL lookups returned nothing this run` | Throttled before the first answer. Bing findings are left alone rather than resolved; the next run picks up where it stopped. |
| `this API key can see no sites` | The key is valid but the site was never added, or was added under another Microsoft account. |
| `no property covering www.indiecore.net` | The only registered property is a different domain — wrong account, or the wrong key. Not triggered by an apex-vs-`www` difference; those are one site to Bing. |
| Bing findings neither open nor resolve | The key is unset, so that half did not run. A source that did not run proves nothing, so its findings are deliberately left alone. |
| `bing-coverage` on a new property | Expected. bingbot reaches a new site more slowly than Googlebot, and IndexNow announces a URL without scheduling a crawl. |

The workflow cannot fail a deploy — it runs after `CI/CD` finishes, in a
separate run.
