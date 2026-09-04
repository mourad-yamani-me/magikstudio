---
title: Your post title here
date: 2026-01-01
description: One or two sentences. This is what shows on the blog index and in Google results, so make it count.
tags: [devlog, design]
# Code belongs on GitHub — link it, don't paste it. Optional.
#   gist  -> one file / a snippet / a short guide
#   repo  -> a project someone would clone
# Either URL goes in `code:`; the card labels itself accordingly.
code: https://gist.github.com/IndieCoreDev/abc123
codeLabel: The full component
# Required — the build refuses a post that has not decided.
#   true  -> announced on LinkedIn once the post is live. Write `linkedinText`
#            below as well, or it goes out as this file's title and description.
#   false -> not announced. Most posts. A real answer, not a placeholder.
linkedin: false
# linkedinText:
#   - The hook. One or two sentences that stand on their own.
#   - What you did, and what came out of it.
draft: true
---

Delete this file's `draft: true` line — or copy it to a new filename — to publish.
The filename becomes the URL: `content/blog/my-post.md` → `/blog/my-post/`.

## Headings become sections

Regular paragraphs. **Bold** and *italic* work, and so do
[internal links](/games/soda-jam-color-sort/) and [external ones](https://example.com).

- Bullet lists
- Work as expected

1. So do
2. Numbered lists

> Blockquotes look like this — useful for pulling out a key line.

`inline code` and fenced blocks both render:

```
some code
```

Images go in `public/assets/blog/` and are referenced as `/assets/blog/name.jpg`.

## Where code should live

Short snippets — under ~30 lines — belong inline; they're what makes a post readable.

Anything longer, and anything someone would want to *run*, belongs on GitHub. Put the URL in
`code:` and it renders as a link card at the top of the post.

| Use a **Gist** for | Use a **repo** for |
| --- | --- |
| one file | several files |
| a snippet worth copying | something worth cloning |
| a short how-to | a project with a README, issues, releases |

Gists are the right default. They still get syntax highlighting, revisions, comments and
forks — without you having to maintain a repository for twenty lines of code.

That way people can clone, fork and star it, you get the traffic back to your GitHub, and the
post stays about the reasoning rather than becoming a wall of code.

## Things worth knowing

- **Reading time** is calculated automatically from the word count.
- **Ordering** is by `date`, newest first. Use `YYYY-MM-DD`.
- **A `date` in the future holds the post** until that day, then the daily build puts it out —
  index, sitemap, feed and cross-post together. Merge it whenever it is ready.
- **The date is not yours to pick.** Run `npm run schedule -- --claim <post-slug>`; it answers
  with the next free day and records the claim. The build refuses a date nothing claimed.
- **`draft: true`** keeps a post out of the site entirely — not in the index, not in the
  sitemap, not in the RSS feed.
- The build **fails** if `title` or `date` is missing, so a broken post can't ship.
