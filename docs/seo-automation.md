# SEO automation

Two workflows, doing two different jobs.

| Workflow | Script | When | What it is for |
| --- | --- | --- | --- |
| **SEO ping** | `scripts/seo-ping.mjs` | after each production deploy, and Mondays | Announce the live URL set. Report the current state. |
| **SEO watch** | `scripts/seo-watch.mjs` | daily, 06:17 UTC | *Remember* the state, and raise what changed. |

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

Each rule earns its place by implying a *different* fix. A finding you would act
on the same way as its neighbour is noise, and noise is what makes a report stop
being read — see `AGENTS.md`, "How to add a check".

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

Set expectations accordingly. Sixteen URLs, a sitemap linked from `robots.txt`
and a crawlable site means Google already knows every page exists. Pinging
harder does not create demand. The genuinely useful output here is the
**index-status table**, which distinguishes two very different problems:

- URLs not indexed → a discovery or quality problem, worth fixing.
- URLs indexed with no traffic → a ranking or demand problem. No submission
  API touches that; it needs content people are actually searching for.

## IndexNow

Works out of the box, no setup. The key lives in `_source/indexnow-key.txt`,
`build.mjs` copies it to `dist/<key>.txt`, and `scripts/verify.mjs` fails the
build if the two ever drift. The key is public by design — it authorises
submissions only while it is readable at that exact URL on that exact host.

To rotate it, put a new 8–128 character hex string in `_source/indexnow-key.txt`
and deploy. Nothing else references it.

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

npm run seo:watch                 # observe, compare, update the ledger
npm run seo:watch -- --brief      # just the open findings — no network, no credentials
npm run seo:watch -- --dry-run    # observe and report, write nothing
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

The workflow cannot fail a deploy — it runs after `CI/CD` finishes, in a
separate run.
