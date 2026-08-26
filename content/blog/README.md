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

## Images

Put them in `public/assets/blog/` and reference them as `/assets/blog/name.jpg`.
Resize to about 1200px wide first — the build does not process post images.

## Want help writing one?

Give me the rough facts — the error, the versions, what you tried, what fixed it — and I'll
turn it into a post. I can't invent your experiences, but I can structure and write them up.
