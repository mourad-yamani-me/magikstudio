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

## Frontmatter

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Build fails without it. Aim for under 48 characters — the site name is appended. |
| `date` | yes | `YYYY-MM-DD`. Controls ordering. |
| `description` | no, but do it | Shows on the index and in Google results. One or two sentences. |
| `tags` | no | `[unity, android]` |
| `code` | no | A gist or repo URL. Renders a link card; the type is detected from the host. |
| `codeLabel` | no | Overrides the card's title. |
| `draft` | no | `true` keeps it out of the site, sitemap and RSS entirely. |

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
  a gist can never advertise a URL that 404s.
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
