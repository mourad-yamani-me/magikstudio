# Writing a post

```bash
cp content/blog/_template.md content/blog/my-post-slug.md
# write it, then:
npm run check      # build + verify
npm run dev        # look at it: http://localhost:4321/blog/my-post-slug/
```

The filename is the URL. `my-post-slug.md` → `/blog/my-post-slug/`.

Publish by setting `draft: false`, then push and merge. Files starting with `_` are never
built.

To publish it on a later day, give it that `date` and merge it anyway — see
[Publishing on a date](#publishing-on-a-date).

## Frontmatter

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Build fails without it. Aim for under 48 characters — the site name is appended. |
| `date` | yes | `YYYY-MM-DD`. Controls ordering, and *when the post comes out* — a date ahead of today holds it. |
| `order` | no | A number. Orders posts sharing a `date`, ascending, so a series published in one go reads part 1 first. Without it the tie falls to the order the filesystem lists the directory in, which is not the same on macOS and on the CI runner. |
| `description` | no, but do it | Shows on the index and in Google results. One or two sentences. |
| `tags` | no | `[unity, android]` |
| `code` | no | A gist or repo URL. Renders a link card; the type is detected from the host. |
| `codeLabel` | no | Overrides the card's title. |
| `changes` | no | Post-publication edits. A block list, one `YYYY-MM-DD — what changed` per line. See below. |
| `draft` | no | `true` keeps it out of the site, sitemap and RSS entirely. |
| `keySections` | no | Headings to promote in the post's contents list — the two or three a reader is actually here for, e.g. `[How do I install it, The motivation]`. Matched against the heading text; a name matching none, or more than one, **fails the build** and prints the headings it found. |
| `schedule` | no | A reason, e.g. `schedule: Play policy change`. Exempts the post from the day's quota and from the day off. Printed by every build — see [the publishing calendar](#the-publishing-calendar). |
| `devto` | **yes** | `true` cross-posts the whole article to dev.to, canonicalised back here. `false` keeps it on this site. The build refuses a post that has not decided, for the reason below. See [`docs/cross-posting.md`](../../docs/cross-posting.md). |
| `linkedin` | **yes** | `true` announces the post on LinkedIn once it is live — a blurb and a link card, not a copy. `false` is a real answer and most posts carry it. The build refuses a post that has not decided, because forgetting is invisible: nothing breaks, and the post simply never leaves the site. See [`docs/linkedin.md`](../../docs/linkedin.md). |
| `linkedinText` | no | The blurb, a block list with one paragraph per item. Without it LinkedIn gets the title and `description`, which reads like a machine wrote it. |

## Publishing on a date

A post dated ahead of today is held: it is not on the index, not in the sitemap, not in the
feed, and not cross-posted. On the first build on or after its date it appears, everywhere, at
once.

```bash
date: 2026-10-14      # merge it whenever; it comes out on the 14th
npm run schedule      # what is held, what is due, what is already out
```

Nothing has to be run on the day. `ci-cd.yml` builds daily at 14:09 UTC — around 10am in New
York, which is when a new post is most read — and a build on or after the date is all the post
needs. The gist follows at 14:33 and the dev.to cross-post at 15:41, in that order and for that
reason: neither may go out pointing at a page the site has not published yet.

Four things follow from this, all of them deliberate:

- **The clock is UTC**, on the laptop and on the runner both. A post dated the 14th goes out at
  16:09 Paris time on the 14th, not at midnight.
- **It goes out even if nothing else changed.** The daily run asks the live sitemap what is
  already published rather than trusting "is anything dated today", so a cron that was delayed,
  a runner that failed, or a schedule GitHub paused for inactivity all catch up on the next run
  instead of stranding the post.
- **`draft: true` still wins.** A draft is never published, whatever its date says. Use the
  date for "this is finished, it comes out Tuesday" and `draft` for "this is not finished".

- **You can read it before it ships.** `npm run dev` and the PR preview build the held post for
  real, marked `Publishes <date>` and served `noindex` so a leaked preview URL cannot be indexed
  ahead of the page itself. It stays out of the sitemap and the feed in both. Production never
  builds it at all — the flag is set on pull requests only, which are the runs that cannot
  deploy production.

A held post is still fully checked — `npm run check`, `npm run style` and the Lighthouse budget
all run on the PR that merges it, and the build prints `held /blog/<slug>/ — publishes <date>`
so it is visible in the log rather than silently absent. Its gist, if it has one, is generated
in that PR and published by `sync-gist.yml` on the day the post lands, not before: a gist whose
"full write-up" link 404s is the thing being avoided.

## The publishing calendar

Dates are not chosen by hand. The calendar decides how many posts a day can carry, and you
ask it for the next free slot:

```bash
npm run schedule                                  # the queue, and the next free days
npm run schedule -- --claim my-post-slug          # take the next free slot
npm run schedule -- --claim my-post-slug --on 2026-10-14   # take a specific day
npm run schedule -- --claim my-post-slug --release         # give it back
```

It prints the date; put that date in the frontmatter. That is the whole workflow, and it is
the same one an agent follows — which is why it is a command and not a paragraph of judgement.

```
  claimed 2026-10-14 for my-post-slug — slot 1 of 2

  put it in the frontmatter:   date: 2026-10-14
```

**The rule**, in [`_source/schedule.json`](../../_source/schedule.json):

| | |
| --- | --- |
| Posting days | every day except **Sunday** |
| Per day | **1–3**, and which of those a given day gets is drawn |
| Per month | a total drawn between **30 and 60**, which the daily quotas add up to |
| In force from | **2026-09-02** — everything published before that is not checked |

**The quotas are drawn, not written down.** A file listing every day of the next year is one
somebody has to extend every December; a draw seeded on the date itself is the same calendar,
derived, and it never runs out. The seed is the date string, so `2026-10-14` holds the same
number of slots on your laptop, on the runner, today and in three years. `Math.random()` would
have made the same commit pass CI once and fail the next time.

Because the month is drawn too, a heavy month and a quiet one look different rather than
tidy: 26 posting days might carry 38 posts one month and 56 the next, some days holding one
and some three.

**Claims live in the ledger**, not in the post. `_source/schedule.json` records which slug
took which day, so a slot can be reserved before the post exists — and the build refuses a
post whose date nothing claimed, which is what stops two branches quietly landing on the same
day. Commit the ledger with the post.

**The build is the enforcement.** `npm run build` fails, naming the fix:

```
  ERROR  calendar: 2026-10-14 holds 2 posts and its quota is 1: a-post, b-post
         — re-claim the extra one, or add `schedule: <reason>` to it if it has to go out that day.
  ERROR  calendar: b-post is dated 2026-10-14 but nothing claimed that slot
         — run `npm run schedule -- --claim b-post --on 2026-10-14` to record it.
```

**The exception is `schedule:` in the frontmatter**, and it carries its reason:

```yaml
date: 2026-10-14
schedule: Play policy change, had to go out the day it landed
```

That post does not count against the day's quota and may sit on a Sunday. Every override is
printed by the build and by `npm run schedule`, so it stays visible instead of becoming the
normal way to post. If overrides start appearing weekly, the rule is wrong — change the
numbers in the ledger rather than working around them.

## Editing a post after it is published

Small fixes — a typo, a broken link, a clearer sentence — just get made. Nothing to record.

Record a change when a reader who already read the post would want to know: a correction, a
reversal, something you got wrong, or an addition that changes the conclusion.

```yaml
changes:
  - 2026-09-03 — Zone 2: what a reader caught about immutable assets, and why the fix is a query
  - 2026-09-11 — Replaced the benchmark; the first one measured a warm cache
```

It is a block list rather than the inline `[a, b]` form because that one splits on commas, and
an entry written as prose has a comma in it sooner or later. The failure there is a silently
truncated list, not an error, which is the worst shape for a field nobody re-reads.

**Where it goes.** Put the substance where it belongs in the article — a correction is worth
most next to the passage it corrects — and let the frontmatter carry the one-line record. The
build renders a *Change history* section under the article, stamps `Updated <date>` next to
the reading time, and `scripts/devto.mjs` appends the same list to the cross-post, so the copy
never claims the post has not been revised.

**What it moves, and why it matters.** `updated` is not a field you write: it is derived from
the newest entry, because two places holding the same date is two places that can disagree.
It drives the JSON-LD `dateModified` and the sitemap's `lastmod`. Before this existed
`dateModified` was hardcoded to the publish date, so a materially revised post went on telling
Google it had never changed.

Three things fail the build, each of which has a message naming the fix: an entry that is not
`YYYY-MM-DD — text`, an entry dated before the post itself, and a `dateModified` in the future
— which is what you get by copying a date off the publishing calendar instead of using the day
the edit happened.

## Tags

Tags render on the index card, on the post, and into the page's JSON-LD `keywords`. There are
no tag archive pages, so an unused tag costs nothing structurally — what it costs is a reader
seeing two words for one subject, and a keywords list that says the site covers more ground
than it does.

**Reuse before inventing.** The vocabulary in use, by area:

| Area | Tags |
| --- | --- |
| Games | `gamedev` `puzzle` `level-design` `difficulty` `procedural-generation` `game-economy` `free-to-play` |
| Mobile build | `capacitor` `android` `apk` `gradle` `r8` `release` |
| Web build | `vite` `ci-cd` `github-actions` `cloudflare` `hosting` |
| Web quality | `performance` `lighthouse` `accessibility` `seo` `images` `css` `javascript` `web` |
| Working with AI | `ai` `claude-code` `context-engineering` `workflow` |
| Store and legal | `google-play` `privacy` `security` |
| Cross-cutting | `architecture` `testing` `design` `monorepo` |

Three or four tags is the norm; five is a lot. Two rules that came out of getting it wrong:

- **A tag has one meaning across the site.** `performance` here means page speed. A post about
  an app download being 13 MB is about bytes, not speed, and tagging it `performance` puts two
  different subjects under one word.
- **Prefer the term someone would search.** `apk` and `r8` earn their place as singletons
  because people type them. `build`, `tooling` and `layout` do not — they are categories, and
  every post is in one.

## Choosing what to write

```bash
npm run topics                                  # rank subjects, merge into topics.json
npm run topics -- --validate                    # gate them BEFORE writing anything
npm run topics -- --claim=<id>=<post-slug>      # this one became a post: stamp its target
npm run topics -- --score                       # did the published ones work?
npm run schedule                                # the queue, best subject first
```

**Do not pick from the list by eye.** `npm run schedule` ends with the validated subjects in
rank order and the number of free slots in the next thirty days beside them. There are around
a hundred of the first and a few dozen of the second, so choosing by which line caught your
attention is choosing at random. Rank is one 0–100 number per subject:

| Term | Worth | Why that weight |
| --- | --- | --- |
| Demand | up to 60 | Logged and anchored at a hundred readers a year: 1k → 20, 10k → 40, 100k → 60. The gap between 500 and 5,000 decides what to write; the gap between 40,000 and 50,000 does not. |
| Winnable | up to 30 | Demand you cannot take is worth nothing — a maintained answer already sits where the post would go. |
| Discovery | up to 10 | How many autocomplete prefixes offered it. Proves a phrasing is real, says nothing about volume, so it only breaks ties. |

Write nothing that has not passed `--validate`. It answers four questions per subject, and a
subject that fails any of the first three is a day of work spent on a page nobody will reach:

| Gate | Measured by | Fails when |
| --- | --- | --- |
| Demand | Stack Overflow view counts, annualised | under ~2000 readers a year |
| Winnable | share of those answers stale or unanswered | a current, maintained answer already exists |
| Indexable | robots, sitemap, slug collision, linking parent | the page would be blocked or orphaned |
| Reproducible | probes this machine for the toolchain | it needs your Play Console, not this laptop |

**Stack Overflow views are not keyword volume, and the script never pretends otherwise.**
They count people who reached one page about the exact problem, so they are a *floor* under
the searching population — most people who search never open Stack Overflow. A floor is
enough to separate "thousands hit this" from "nobody does", which is the only distinction
that changes what to write.

Its blind spot is reported rather than hidden: zero questions comes back as `UNMEASURED`, not
`NO-GO`. Stack Overflow covers programming problems and has nothing to say about a Play
Console policy screen, a tool released last year, or a player hunting level answers. Those
subjects can only be judged by publishing one and reading `--score`.

The fourth gate is the one that decides how the post gets written. `reproducible: yes` means
the error can be produced on this machine, so the post can carry the real console output, the
real version numbers and the false leads that actually cost time — the things a post assembled
from research cannot have, and the reason shape 1 below ranks at all.

Everything that survives gets a **success condition** stamped at publish time — four more
gates, with dates, counted from the publish date:

| Gate | Default | Why that one |
| --- | --- | --- |
| Indexed | 14 days | separates "Google never found it" from "Google found it and nobody cares" |
| Impressions | ≥ 50 by day 60 | the only proof the subject had demand |
| Position | ≤ 20 by day 90 | below that nobody sees it, whatever it says |
| Clicks | ≥ 5 by day 90 | position without clicks is a title problem |

Those numbers are provisional and say so — a site this young has no baseline. Every `--score`
run appends a snapshot to the entry's `history`, and once three posts have been measured at a
comparable age the targets become the median of what this site actually achieves.

Evidence comes from two places, worth very different amounts:

- **Search Console** — queries the site is already shown for. Real demand, and it splits three
  ways: `stranded` (impressions, position > 20 — *that* is a post), `near-miss` (position
  5–20 — fix the page that ranks, a second post competes with the first) and `unclicked`
  (ranks well, nobody clicks — rewrite the title). Needs `GOOGLE_SERVICE_ACCOUNT_JSON`, same
  credential as `npm run seo`.
- **Google autocomplete** — expanded from seeds in the script. Proves a *phrasing* is real,
  says nothing about volume. It is the bootstrap source, and all there is until the site has
  history.

Autocomplete returns seventeen spellings of one article, so they are clustered: one row per
subject, with the variants listed under it. **Those variants are the deliverable** — the post
should contain each string verbatim, because that is what somebody pastes into Google.

Candidates are filtered against what this studio has actually done (the `SEEDS` and
`CAPABILITY` lists in the script). A perfect keyword you have not lived produces a post you
have to invent, and shape 1 below — the one that ranks — needs the real error string, the
real versions and the real false leads.

`content/blog/topics.json` is the ledger and is committed. The point is the record of what
was predicted, not a snapshot of what is trending: a subject that missed its condition is
worth more than one that was never written down, because `--score` names which of the four
failures it was and what to do about it.

## The targets a post is written against

`--validate` leaves an `seo` block on every subject that cleared the gate. It is the answer to
"what does this post actually have to say", and it is harvested rather than invented:

| Field | Where it comes from | Checked how |
| --- | --- | --- |
| `primary` | the subject itself | must appear **verbatim**, in the title or the body |
| `keywords` | the autocomplete variants | **60%** must appear verbatim |
| `questions` | autocomplete asked in question form, plus the real Stack Overflow question titles `--validate` already downloads | **50%** must be answered under a heading |
| `declined` | written by you | questions this subject does not answer, each with a reason. Removed from the target list, printed on every run |
| `entities` | words two or more of the above agree on | reported, never enforced |

Four more ask *where* the subject appears rather than whether it does. All three shares compare
the subject's **core words** — the ones its own variants agree on — not the whole phrase, because
a title has 48 characters and some primaries are longer than that:

| Placement | Threshold | Why |
| --- | --- | --- |
| Title | 60% of core words | the title decides the click; a reader scanning results must recognise their problem |
| Slug | 60% of core words | **the only one with a deadline** — free to change until the post ships, a permanent 301 after |
| First 100 words | **reported, not enforced** | see below — this repo's own posts cannot justify a threshold |
| Density | under 2.5% | a ceiling, not a target. The highest here is 0.69%, so it fires only on a post written for a crawler |

The four posts that did the work score 75–100% on the title and 83–100% on the slug; the one
that did not scores 29% on both, which is where 60% comes from.

**The opening share is printed and never enforced, and that took two attempts to get right.**
Requiring the exact phrase there was tried first and rejected — one post in this repo carries
it and the four that do not include the two best. A core-word share at 50% replaced it, on a
measurement that turned out to be wrong: it matched words as substrings, so the core word `ad`
scored a hit on "already" and "advanced". With word matching the real spread is 33–100% for the
good posts against 29% for the weak one. A four-point gap is not a threshold, it is a coin
toss, and AGENTS.md is explicit that a flaky check is worse than no check. So the number is
reported for a human to glance at and nothing fails on it.

```bash
npm run keywords                                      # every post that has a topic behind it
npm run keywords -- --only <slug>                     # one post
npm run keywords -- --topic <topic-id> <post-slug>    # a draft, before it claims the topic
npm run keywords -- --list                            # what each post is supposed to cover
```

**This is a drafting loop and it is deliberately not in CI.** Write, run it, read the four
phrasings you did not use, work them into prose that was going to exist anyway, run it again.
It exits non-zero so an agent can iterate against it without a human reading the output.
`npm run check` does not call it and no workflow does — a check that is meant to fail on an
unfinished file cannot also be a merge gate.

**A question counts as answered when one heading carries 70% of its words**, not when the
heading is the question verbatim. "How do I fix gradle build failed in unity" is answered by
`## Fixing the Gradle build`. Demanding the interrogative back would turn every post into an
FAQ page, which is a shape Google has spent two years demoting.

*Most* of its words, not all of them. Requiring every word was satisfiable for a four-word
question and impossible for a ten-word one, so questions were capped at eight words to
compensate — which threw away 46% of the on-topic material, including the biggest question on
several subjects: "unity gradle build failed while trying to build project as an apk", 29,731
views. The cap is now 12 words and the matcher scales with the question.

**Two problems can share every word.** "Limited ad serving" is a verification problem and also
a policy-review problem, and no topicality threshold can tell them apart — they use identical
vocabulary. When a harvested question is a different problem, decline it:

```json
"declined": [
  { "q": "temporary ad serving limit placed on your admob account",
    "why": "the policy-review limit, not the verification one. The post says so and cannot lift it." }
]
```

A declined question leaves the target list entirely, so the shares are of what the post
actually undertook. Every decline is printed on every run, pass or fail, and the reason is
required — otherwise the field is just a way to make anything pass. Declining is for a
different problem, never for a question you would rather not answer.

**Why shares and not "all of them".** Requiring every variant verbatim was the rule here for
months, and measuring the published posts against it afterwards gave 7/10, 6/7 and 2/10 — it
would have failed the two best posts in the repo and passed nothing. Ten autocomplete variants
are ten spellings of one sentence, and a post containing all ten reads like it was written for
a crawler. 60% and 50% are the numbers that separate the posts that did the work from the one
that did not, measured off this repo.

The five posts published before the block existed carry `seo.exempt` and are reported as
exempt rather than skipped. They are already indexed, and rewriting an indexed page to satisfy
a check invented afterwards risks the ranking it has.

## Four shapes that work

### 1. A problem you solved  *(Unity, engine, build)*

The most useful thing you can publish, because someone is searching for exactly it right now.

```
Symptom      — the error message or behaviour, verbatim. This is what people google.
Context      — versions, platform, what you were doing.
False leads  — what you tried that didn't work. Saves the reader hours.
Cause        — what was actually wrong.
Fix          — the change, with a snippet or a gist link.
Takeaway     — how to avoid it next time.
```

Put the exact error string in the post. Verbatim error messages are how people find you.

### 2. Shipping and store  *(Google Play, ASO, AdMob)*

Hard to find written down, so it ranks well.

```
What you were trying to do  → what went wrong or what you tested
What the rules actually say → the concrete steps that worked
What you'd do differently
```

Be specific about dates and versions — policies change, and readers need to know when you
wrote it.

### 3. A design decision  *(reads for players and developers)*

```
The problem in the game    — what wasn't working, ideally with a number
Options considered         — and why they were rejected
What shipped               — and what happened after
```

Screenshots and before/after help enormously here.

### 4. A game update  *(for players)*

Short. Three or four paragraphs.

```
What's new       — new levels, features, fixes
Why              — one line, often a player request
Link to the game — /games/<slug>/ and the Play Store
```

These give returning players a reason to come back and help the site rank for your game
names.

## Embedding gist files in the article

`code:` renders a link card at the top. To show the code *inline*, where you are talking
about it, use an embed:

```
{{gist:wrangler.jsonc}}          the whole file
{{gist:ci-cd.yml#head}}          everything above `jobs:`
{{gist:ci-cd.yml#preview}}       one job, found by name
{{gist:ci-cd.yml:94-160}}        explicit lines — avoid, they rot
```

**Prefer anchors over line numbers.** `#head` and `#<jobname>` are resolved from the YAML
structure, so they keep pointing at the right thing when the file changes above them. Line
numbers silently start showing the wrong code.

The content is read from `gist/` at build time — the same files the gist is published from —
so the article, the gist and the live config cannot drift apart. Each embed gets a header
with the filename and a link to that specific file in the gist.

The build **fails** if the filename does not exist in `gist/`, so a renamed file can't leave
a silent hole in a published post.

GitHub's own `<script>` embed is deliberately not used: it is a render-blocking third-party
request, arrives unstyled, and would break the Lighthouse budget.

## Code: gist or repo?

| Gist | Repo |
| --- | --- |
| one file | several files |
| a snippet worth copying | something worth cloning |
| a short how-to | a project with a README, issues, releases |

Publish both from **github.com/IndieCoreDev**. Gist is the right default — you still get
highlighting, revisions, comments and forks without maintaining a repository for twenty lines
of code.

Keep inline snippets under ~30 lines. Anything longer goes in `code:` so the post stays about
the reasoning.

**One fenced block gets one copy button.** So the fence is the unit a reader copies, and that
is an authoring decision, not a styling one:

- commands meant to be **run one at a time** — two slash commands typed into a prompt, a
  claim then a check — get **one fence each**, so each can be taken on its own
- a script, a config file, or a shell sequence meant to run in one go stays in **one fence**;
  splitting it would make the reader copy four times to get one thing

Getting this wrong is quiet. A reader copies both lines, pastes them where only the first can
run, and blames the instructions.

## Publishing a gist for a post

**Do this while writing the post, not after.** A post that explains a script and doesn't link
it makes the reader retype what you already have in a file.

Gists are generated from the real files, never hand-copied, so they cannot drift. One
subdirectory per gist:

```
gist/
  gists.json              written by build-gist.mjs — dir → gist description
  cloudflare-workers/     0-README.md, wrangler.jsonc, ci-cd.yml
  build-gates/            0-README.md, verify.mjs, lighthouse-check.mjs
```

To add one, append an entry to `GISTS` in `scripts/build-gist.mjs`:

```js
{
  dir: 'build-gates',
  marker: 'Build gates for a static site — output verification and a Lighthouse budget',
  post: 'build-reviews-ai-code',          // the post it links back to
  files: () => ({ 'verify.mjs': sanitize(read('scripts/verify.mjs')) }),
  readme: url => `# …`,                   // 0-README.md, ending with the backlink
}
```

Then `node scripts/build-gist.mjs` and commit `gist/`.

- **`marker` is the identity.** The workflow finds the gist by that description string, so
  changing it later creates a *second* gist instead of updating the first.
- **`post` is checked.** The build refuses to run if that post is missing or still a draft, so
  a gist can never advertise a URL that 404s. It takes a list when more than one post carries
  the same gist as its `code:` card — `build-gates` is the `code:` card on three — and the
  gist then links back to every one of them instead of only the first.
- **The backlink is composed, not written.** The template is the body; the link under the H1
  and the one in the footer are generated from the post's own `title:`, so all ten read the
  same and a new gist cannot forget one. Anchor text is the title because that is the text
  someone copies when they cite you.
- **`sanitize()` and the leak guard** strip the project name, domain and account handles.
  Anything identifying that slips through fails the build rather than getting published.

### The two-step, and why the build nags you

The gist doesn't exist until `sync-gist.yml` runs on `main`, so its URL isn't knowable while
you're writing. Merge the post first, read the URL out of the workflow summary, then add it:

```yaml
code: https://gist.github.com/IndieCoreDev/<id>
codeLabel: Both scripts, ready to drop in
```

Until you do, every build prints:

```
warn  gist/build-gates/ links to /blog/build-reviews-ai-code/, but that post has
      no `code:` field — add the gist URL so readers can find it.
```

That warning is the only thing standing between "I'll add the link later" and a gist nobody
ever finds. It is deliberately not an error — there's a legitimate window where the URL
genuinely doesn't exist yet.

### Cross-posting a post to dev.to

Add `devto: true` to the frontmatter and `npm run devto` will pick it up. The copy is
canonicalised back to this site, which is the part that keeps it from competing with the
original. Full procedure in [`docs/cross-posting.md`](../../docs/cross-posting.md).

### Embedding files inline

`{{gist:verify.mjs}}` finds the file in whichever gist directory holds it, so posts don't
need to know the layout. Use `{{gist:build-gates/verify.mjs}}` if the same filename ever
appears in two gists; ambiguity fails the build rather than picking one.

## Images

Put them in `public/assets/blog/` and reference them as `/assets/blog/name.jpg`.
Resize to about 1200px wide first — the build does not process post images.

## Style check

```bash
npm run style      # advisory; `npm run style -- --strict` exits non-zero
```

Flags the patterns that make a post read as machine-written. It deliberately does *not*
flag em dashes: this site runs about ten per thousand words and always has, so scoring them
the way a generic AI-detector would just tells you to stop sounding like yourself.

What it measures instead is **formula** — the same rhetorical move landing at a regular
interval:

| Signal | Why it's there |
| --- | --- |
| `"not X, it's Y"` density | the most recognisable LLM cadence; one per post is fine, four is a tic |
| bolded claim in most sections | emphasis on a schedule stops being emphasis |
| sentence-length stdev | uniform rhythm; below ~4 is what detectors key on |
| filler formulas | "that's the point", "which is why", "at the end of the day" |
| AI-flavoured vocabulary | delve, leverage, crucial, ecosystem, underscores |

Thresholds are calibrated against the posts already published here, so a passing score means
"sounds like the rest of the site", not "sounds like nobody". Drafts are skipped.

Worth saying plainly: Google does not penalise a post for being AI-assisted — its spam
policy targets low-value content produced at scale, whatever wrote it. The reason to run this
is that readers can tell, and stop trusting the writing when they do.

## Want help writing one?

Give me the rough facts — the error, the versions, what you tried, what fixed it — and I'll
turn it into a post. I can't invent your experiences, but I can structure and write them up.
