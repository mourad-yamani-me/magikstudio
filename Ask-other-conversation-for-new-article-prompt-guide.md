Now write this up as a blog post in my repo: /Users/oettaibs/codes/Apps/indie-core-dev

Read AGENTS.md and content/blog/README.md first and follow them — they are the
source of truth, not your defaults.

1. Seed it yourself. `npm run topics` only expands a fixed SEEDS list in
   scripts/topics.mjs — it knows nothing about this conversation. Add a seed for
   what we just did:
     npm run topics -- --seed="<the subject in the words someone would google>"
   If the candidates get filtered out, the phrase shares no word with the
   CAPABILITY set — add the seed to the SEEDS array and commit it.

2. Then `npm run topics -- --validate`. Write nothing that has not passed. If it
   fails, tell me and stop. It works through the proposed subjects best first,
   so what comes back at the top is the queue, not a coincidence of file order.

   `npm run schedule` prints the same ranking against the free slots in the next
   thirty days. If the subject we just lived is not near the top, say so and
   tell me what is — I would rather know I am spending a slot on rank 40 than
   find out in six weeks from `--score`.

3. Get the targets before you draft, not after. `--validate` leaves an `seo`
   block on the subject: the primary phrase, the keyword variants, and the real
   questions people ask, harvested from autocomplete and from the Stack Overflow
   question titles. If the subject is already written or already claimed,
   `--validate` will not look at it again — use:
     npm run topics -- --harvest=<topic-id>
   Read the block before you write a word. It is the outline.

4. Draft, then run the check, then fix, then run it again:
     npm run keywords -- --topic <topic-id> <post-slug>     # while drafting
     npm run keywords -- --only <post-slug>                 # once the topic is claimed
   It exits non-zero until the post carries its primary phrase verbatim, 60% of
   its keywords verbatim, and answers 50% of its questions under a heading.
   Iterate against it until it is green — that is what it is for. It is NOT in
   CI and `npm run check` does not call it, so nothing else will catch this.

   A question counts as answered when a heading carries every content word of
   it. It does not have to be phrased as a question. If the post already answers
   something and the check disagrees, the heading is the thing to fix, not the
   prose — and that is usually the real bug: the answer is in there and nothing
   on the page says so where a searcher scanning results can see it.

   Do not pad. If a keyword cannot go into a sentence that was going to be
   written anyway, leave it out and tell me which one and why.

5. Only what I actually lived. The real errors, the real versions, the false
   leads that cost me time. No invented steps, no filler research, nothing we
   did not verify together. If a part is missing, ask me — do not guess.

6. My experience, not my identifiers. The post is public. Anything that names my
   accounts, my machine or my users gets replaced by the vendor's documented
   sample value or an obvious placeholder, with a note that it is redacted. The
   errors, versions, config shapes and output are the substance — keep those and
   swap the identifiers inside them. Before showing me the draft, grep your own
   post for anything account-shaped and tell me what you replaced.

7. Specific slug — the exact problem, never the raw topics.json query. Put the
   topic variants verbatim in the post.

8. Date from the calendar, never by hand: `npm run schedule -- --claim <slug>`,
   that date in the frontmatter, `_source/schedule.json` committed with the post.

9. Frontmatter per the README, and `linkedin` is required — decide it, and write
   a real `linkedinText` if it is true. `code:` card if the post explains a script.

   `linkedin: true` and `devto: true` are a veto, not a vote: they say the post
   MAY go out, and which post actually takes the slot is decided by the subject's
   rank. So `true` on a low-rank post is not a promise it goes out this week.

10. One of the four post shapes, start to finish.

11. Branch `content/<slug>`, stage explicit paths (never `git add -A`),
    `npm run check`, `npm run style` and `npm run keywords` all green, then a PR.
    Never main. No AI co-author or "generated with" line in the commit.

Show me the draft before you push.
