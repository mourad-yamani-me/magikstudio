/**
 * The SEO target block on a topic, and the two questions asked of it.
 *
 * A topic used to carry evidence that somebody searches for it and a success
 * condition to judge it by six weeks later. What it did not carry was anything
 * the *writing* could be checked against: `content/blog/README.md` has said
 * since the first post that the variants "are the deliverable — the post should
 * contain each string verbatim", and nothing ever read the post to find out.
 * Three of the five published posts were measured against it afterwards and hit
 * 7/10, 6/7 and 2/10. The rule was true and unenforced, which is the same as
 * absent.
 *
 * So this module holds two things, both shared rather than duplicated:
 *
 *   targets(entry)     what a post on this subject must contain, one shape,
 *                      read the same way by the harvester and the checker.
 *   audit(targets, md) whether a given post contains it, and exactly which
 *                      strings are missing.
 *
 * And one more, which is why it is not called `keywords.mjs`:
 *
 *   rank(entry)        how much traffic this subject is worth, on one 0-100
 *                      scale, so the scarce publishing slots can be spent on
 *                      the best of 98 candidates instead of whichever one was
 *                      nearest to hand.
 *
 * ── Why the thresholds are shares and not "all of them" ──────────────────────
 *
 * Requiring every variant verbatim would fail the two best posts in this repo
 * and pass nothing. Ten autocomplete variants of one subject are ten spellings
 * of the same sentence, and a post that contains all ten reads like it was
 * written for a crawler, which is the thing that stops ranking. The numbers
 * below are the ones that separate the posts that did the work (70%, 86%) from
 * the one that did not (20%) — measured off this repo, per the calibration rule
 * in AGENTS.md, rather than taken off a generic SEO checklist.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT   = path.resolve(import.meta.dirname, '..');
export const LEDGER = path.join(ROOT, 'content/blog/topics.json');

/** Share of `keywords` a post must contain verbatim. 0.6 sits between 0.2 and 0.7. */
export const KEYWORD_SHARE  = 0.6;
/** Share of `questions` a post must answer under a heading. Lower: a heading is a bigger ask. */
export const QUESTION_SHARE = 0.5;
/* Below this the questions gate does not apply at all.
   `Math.ceil(1 * 0.5)` is 1, so a subject that harvested a single question was
   secretly demanding 100% of it — the strictest rule in the file, applied to
   the thinnest evidence, which is exactly backwards. Three subjects were in
   that state. A thin harvest is reported as thin rather than enforced as
   certainty. */
export const QUESTION_MIN = 3;
/* Share of a QUESTION's own words one heading must carry for it to count as
   answered. Not all of them: "every content word in one heading" is satisfiable
   for a four-word question and impossible for a ten-word one, which silently
   turned the harvest into "only short questions allowed" and threw away the
   most-viewed question on several subjects. A share scales with the question. */
export const ANSWER_SHARE = 0.7;
/** ...and never fewer than this many words, so a two-word overlap cannot pass. */
export const ANSWER_MIN_WORDS = 3;

/* Placement. The four above answer "does the post contain its subject"; these
   answer "where". They were added after a post passed the content checks with
   its phrase buried mid-article, its title naming something else and its slug
   naming a third thing — all three caught by hand, which is the definition of a
   check that should exist.

   Measured across every post in this repo that has a topic behind it. The four
   that did the work scored 75-100% on the title, 83-100% on the slug and
   50-100% in the opening; the one that did not scored 29% on all three. So 0.6
   and 0.5 separate them, and like the shares above they are this repo's own
   numbers rather than a generic checklist's. */
export const TITLE_SHARE   = 0.6;
export const SLUG_SHARE    = 0.6;
/* REPORTED, NEVER ENFORCED — and the history is the reason.

   It was enforced at 0.5, on a measurement that said good posts scored 50-100%
   in the opening and the weak one 29%. That measurement was wrong: it used
   substring matching, so the core word `ad` scored a hit on "already" and
   "advanced". With word matching the real spread is 33-100% against 29%, and a
   four-point gap between the best failing post and the worst passing one is not
   a threshold, it is a coin toss. AGENTS.md: a flaky check is worse than no
   check.

   Requiring the exact phrase instead was tried first and is worse — one post in
   this repo carries it and the four that do not include the two best.

   So the number is printed on every run and nothing fails on it. Where the
   subject appears early is worth a human glance and is not worth a gate. */
export const OPENING_WORDS = 100;
/* A ceiling, not a target. Nothing here comes near it — the highest observed is
   0.69% — so it fires only on a post that has been written for a crawler. */
export const MAX_DENSITY   = 0.025;

export const readLedger = () => JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
export const writeLedger = l => fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + '\n');

/* ------------------------------------------------------------------ */
/* words                                                               */

/* The same stop list topics.mjs scores with. Duplicated deliberately: this
   module is imported by the checker, which must not pull in a file that talks
   to Google on import. */
const STOP = new Set(['the', 'a', 'an', 'to', 'in', 'on', 'for', 'of', 'and', 'or', 'is', 'it',
  'my', 'your', 'how', 'why', 'what', 'when', 'not', 'with', 'without', 'that', 'this', 'do',
  'does', 'can', 'i', 'you', 'vs', 'from', 'at', 'be', 'are', 'get', 'got', 'me', 'we', 'if']);

export const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));

/* Text is compared with whitespace flattened and punctuation stripped, so a
   variant broken across two lines by the editor's wrap still counts, and
   `gradle build failed.` matches `gradle build failed`. Without this the check
   fails on formatting, which is the fastest way to get a check switched off. */
export const flatten = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Which words a subject is actually about.
 *
 * Not simply the query's. A long query drags its own tail in — "unity gradle
 * build failed see the console for details" has seven content words, and asking
 * a 48-character title to carry all of them is asking the impossible. Ten
 * autocomplete spellings of one subject agree on the words that identify it and
 * disagree on everything else, so a word carried by half the variants is the
 * subject and a word carried by one of them is that asker's phrasing.
 *
 * Lives here rather than in topics.mjs because the harvester uses it to decide
 * what is on topic and the checker uses it to decide where the topic has to
 * appear. Two copies of that judgement would drift.
 */
export function coreWords(query, variants = []) {
  const q = [...new Set(words(query))];
  if (!variants.length) return q;
  const seen = new Map();
  for (const v of variants) for (const w of new Set(words(v))) seen.set(w, (seen.get(w) || 0) + 1);
  const core = q.filter(w => (seen.get(w) || 0) >= variants.length / 2);
  return core.length ? core : q;
}

/** Strip frontmatter, fenced code and link URLs — the prose a reader actually reads. */
export function prose(raw) {
  return String(raw)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')      // frontmatter
    .replace(/^```[\s\S]*?^```/gm, ' ')                  // fenced code
    .replace(/\]\([^)]*\)/g, '] ');                      // link targets, not link text
}

/** Every ATX heading in the body, as flattened text. */
export const headings = body =>
  [...String(body).matchAll(/^#{2,4}\s+(.+)$/gm)].map(m => flatten(m[1]));

/* ------------------------------------------------------------------ */
/* the target block                                                    */

/**
 * What a post on this subject has to contain.
 *
 * Reads the harvested `seo` block when there is one and falls back to the
 * fields every entry has always had, so an entry harvested before this existed
 * still produces a usable target list rather than an empty pass.
 *
 * @returns {{primary: string, keywords: string[], questions: string[], entities: string[], exempt: string|null}}
 */
export function targets(entry) {
  const seo = entry.seo || {};
  const keywords = [...new Set([...(seo.keywords || []), ...(entry.variants || [])].map(flatten))]
    .filter(Boolean);
  /* Declined questions are removed from the target list here rather than
     forgiven at the gate, so every number downstream is a share of what the
     post actually undertook. They are still returned, because a decision that
     is not printed is a decision nobody can review. */
  const declined = (seo.declined || []).filter(d => d && d.q && d.why);
  const declinedSet = new Set(declined.map(d => flatten(d.q)));
  return {
    core:      coreWords(seo.primary || entry.query, entry.variants || []),
    primary:   flatten(seo.primary || entry.query),
    keywords:  keywords.filter(k => k !== flatten(seo.primary || entry.query)),
    questions: [...new Set((seo.questions || []).map(flatten))].filter(q => q && !declinedSet.has(q)),
    declined,
    entities:  [...new Set((seo.entities || []).map(flatten))].filter(Boolean),
    exempt:    seo.exempt || null,
  };
}

/**
 * Does this post hit its targets?
 *
 * Four verdicts, kept apart on purpose — "the primary phrase is missing" and
 * "six of ten long-tail variants are missing" are different jobs, and a single
 * pass/fail would send you looking at the wrong one.
 *
 * @param {ReturnType<targets>} t
 * @param {string} raw   the post file, frontmatter and all
 * @param {string} slug  the post's filename, which is also its URL
 */
export function audit(t, raw, slug = '') {
  const body   = prose(raw);
  const flat   = flatten(body);
  const title  = flatten((raw.match(/^title:\s*(.+)$/m) || [, ''])[1]);
  const heads  = headings(body);
  /* Two matchers, and mixing them up is a bug that hides in plain sight.

     A KEYWORD is a phrase and must match as a substring — "unity gradle build
     failed" appears inside a sentence and there is nothing to tokenise against.

     A single WORD must match as a word. `flat.includes('ad')` is true of
     "admob", "already", "advanced" and "additional", so the core word `ad`
     scored a hit on any text containing none of it. That inflated every
     placement share: the old slug "two-admob-apps-one-play-listing" reported
     50% of the AdMob subject when it carried 25%. */
  const has     = s => flat.includes(s);
  const wordsIn = text => new Set(String(text).split(' ').filter(Boolean));
  const bodyBag = wordsIn(flat);
  const hasWord = w => bodyBag.has(w);

  /* A question counts as answered when one heading carries MOST of its content
     words — not all of them, and not the question verbatim. "How do I fix
     gradle build failed" is answered by "## Fixing the Gradle build", and
     demanding the interrogative back would make every post read like an FAQ
     page, which is a shape Google has spent two years demoting. The share is
     ANSWER_SHARE; requiring all of them is what forced the 8-word cap that threw
     away the best material on several subjects. */
  const answered = q => {
    const need = [...new Set(words(q))];
    if (!need.length) return false;
    const want = Math.max(Math.min(need.length, ANSWER_MIN_WORDS),
                          Math.ceil(need.length * ANSWER_SHARE));
    return heads.some(h => { const bag = wordsIn(h); return need.filter(w => bag.has(w)).length >= want; });
  };

  const keywordsHit  = t.keywords.filter(has);
  const questionsHit = t.questions.filter(answered);
  const entitiesHit  = t.entities.filter(hasWord);

  const share = (hit, all) => (all.length ? hit.length / all.length : 1);
  const kShare = share(keywordsHit, t.keywords);
  const qShare = share(questionsHit, t.questions);
  const questionsThin = t.questions.length < QUESTION_MIN;

  /* ── placement ──
     Where the subject appears, not whether it does. All three compare the
     subject's CORE words rather than the phrase: a title has 48 characters to
     work with and some primaries are longer than that, so demanding the whole
     string back would fail titles that are doing their job. */
  const shareOf = text => {
    if (!t.core.length) return 1;
    const bag = wordsIn(text);
    return t.core.filter(w => bag.has(w)).length / t.core.length;
  };
  const missingFrom = text => { const bag = wordsIn(text); return t.core.filter(w => !bag.has(w)); };

  const opening = flatten(body.split(/\s+/).filter(Boolean).slice(0, OPENING_WORDS).join(' '));
  const titleShare = shareOf(title);
  const slugShare = slug ? shareOf(flatten(slug)) : 1;
  const openingShare = shareOf(opening);

  /* Occurrences of the whole phrase, weighted by its length, over the body.
     Counting a four-word phrase as one word would report a stuffed post as
     sparse. */
  let hits = 0, at = 0;
  while (t.primary && (at = flat.indexOf(t.primary, at)) !== -1) { hits++; at += t.primary.length; }
  const bodyWords = body.split(/\s+/).filter(Boolean).length || 1;
  const density = hits * words(t.primary).length / bodyWords;

  const problems = [];
  /* The primary is allowed in the title as well as the body: a post whose H1
     is the phrase has covered it more strongly than one that buries it in
     paragraph nine, and refusing that would be a check arguing with a better
     page. */
  const primaryHit = has(t.primary) || title.includes(t.primary);
  if (!primaryHit) problems.push({
    kind: 'primary',
    say: `the primary phrase never appears: "${t.primary}"`,
    fix: 'put it verbatim in the title, the opening paragraph or a heading — it is the query the post is for',
    missing: [t.primary],
  });
  if (kShare < KEYWORD_SHARE) problems.push({
    kind: 'keywords',
    say: `${keywordsHit.length}/${t.keywords.length} keywords verbatim (${Math.round(kShare * 100)}%, needs ${KEYWORD_SHARE * 100}%)`,
    fix: 'these are what people paste into Google — work the missing ones into prose that was going to be written anyway',
    missing: t.keywords.filter(k => !has(k)),
  });
  if (!questionsThin && qShare < QUESTION_SHARE) problems.push({
    kind: 'questions',
    say: `${questionsHit.length}/${t.questions.length} questions answered under a heading (${Math.round(qShare * 100)}%, needs ${QUESTION_SHARE * 100}%)`,
    fix: `a heading carrying ${ANSWER_SHARE * 100}% of the question's words counts — it does not have to be phrased as a question. ` +
         'If a question is a different problem that happens to share the vocabulary, decline it in `seo.declined` with a reason rather than writing about something you never hit',
    missing: t.questions.filter(q => !answered(q)),
  });

  if (titleShare < TITLE_SHARE) problems.push({
    kind: 'title',
    say: `the title carries ${Math.round(titleShare * 100)}% of the subject (needs ${TITLE_SHARE * 100}%)`,
    fix: 'the title is what Google shows and what decides the click — a reader scanning results has to recognise their own problem in it',
    missing: missingFrom(title),
  });
  if (slug && slugShare < SLUG_SHARE) problems.push({
    kind: 'slug',
    say: `the slug "${slug}" carries ${Math.round(slugShare * 100)}% of the subject (needs ${SLUG_SHARE * 100}%)`,
    /* Named as urgent because it is the only one of these with a deadline. The
       URL is free to change until the post ships and costs a permanent 301
       afterwards, so a slug caught here is caught at the last cheap moment. */
    fix: 'rename the file NOW if the post is not live — after it ships this costs a 301 forever. Keep it specific; never use the raw topics.json query',
    missing: missingFrom(flatten(slug)),
  });
  if (density > MAX_DENSITY) problems.push({
    kind: 'density',
    say: `the primary phrase is ${(density * 100).toFixed(1)}% of the body (ceiling ${MAX_DENSITY * 100}%)`,
    fix: 'this reads as written for a crawler. Cut repetitions — the check asks for the phrase to be present, never for it to be frequent',
    missing: [],
  });

  return {
    ok: problems.length === 0,
    primaryHit,
    placement: { title: titleShare, slug: slugShare, opening: openingShare, density },
    keywords:  { hit: keywordsHit,  missing: t.keywords.filter(k => !has(k)),      share: kShare },
    questions: { hit: questionsHit, missing: t.questions.filter(q => !answered(q)), share: qShare, thin: questionsThin },
    /* Entities and the opening share are reported and never enforced. Entities
       are a hint about what the subject is made of rather than a promise about
       what the post says; the opening share has no threshold this repo's own
       posts can justify. Both are worth reading and neither is worth failing on. */
    openingMissing: missingFrom(opening),
    entities:  { hit: entitiesHit,  missing: t.entities.filter(e => !hasWord(e)) },
    problems,
  };
}

/* ------------------------------------------------------------------ */
/* rank — what a subject is worth                                      */

/**
 * One 0-100 number per subject, so 98 candidates and a handful of slots a week
 * can be reconciled without a judgement call every time.
 *
 * Demand dominates, and it is logged: the gap between 500 and 5,000 readers a
 * year decides what to write, the gap between 40,000 and 50,000 does not, and a
 * linear scale would let one outlier own the queue forever. Winnability is the
 * second term because demand you cannot take is worth nothing — a maintained
 * answer already sits where this post would go. The discovery score is last and
 * small: it counts autocomplete prefixes, which prove a phrasing is real and
 * say nothing about volume.
 *
 * @returns {{rank: number, why: string, eligible: boolean}}
 */
export function rank(entry) {
  const v = entry.validation || {};
  const annual = v.demand?.annualViews || 0;
  const gsc = entry.evidence?.source === 'search-console' ? (entry.evidence.impressions || 0) : 0;

  /* Search Console impressions are real demand for THIS site and Stack Overflow
     views are a floor under a population, so they are not the same unit and are
     not added. The larger evidence wins, converted to the same log scale. */
  const readers = Math.max(annual, gsc * 12);
  /* Anchored, not just logged. `log10 * 15` put every subject worth writing
     into a four-point band at the top of the scale — 28,000 readers and 5,800
     came out 60 and 56 — which sorts nothing. Subtracting 2 puts the zero at a
     hundred readers a year, which is genuinely not worth a day, and 20 a decade
     spreads the range that matters: 1k → 20, 10k → 40, 100k → 60. */
  const demand = Math.max(0, Math.min(60, Math.round((Math.log10(readers + 1) - 2) * 20)));
  const winnable = Math.round((v.winnability?.score || 0) * 0.3);
  const discovery = Math.min(10, Math.round((entry.score || 0) * 0.1));

  /* Demand this studio cannot answer. `repro.name === 'unknown'` is validate's
     way of saying it found no reproduction path at all — the post could only be
     assembled from research, and shape 1 in content/blog/README.md, the one
     that ranks, needs the real error string and the real false leads.
     "how remove app from app library" reached second place on 146,000 readers a
     year and harvested questions about deleting apps from an iPhone home
     screen. It is a real subject; it is not this site's.
     A named toolchain that this laptop cannot reach is NOT penalised: "needs
     your Play Console" means somebody has it, and those posts are among the
     best here. */
  const unwritable = v.repro && v.repro.name === 'unknown' ? 25 : 0;

  const verdict = v.verdict || null;
  const eligible = entry.status === 'proposed' && verdict !== 'NO-GO' && verdict !== 'BLOCKED';

  return {
    rank: Math.max(0, Math.min(100, demand + winnable + discovery - unwritable)),
    why: `${readers ? `~${readers.toLocaleString('en-US')} readers/yr` : 'demand unmeasured'}`
       + `, winnable ${v.winnability?.score ?? 0}/100`
       + (unwritable ? ', no reproduction path (-25)' : '')
       + (verdict ? `, ${verdict}` : ', unvalidated'),
    eligible,
  };
}

/** Proposed subjects, best first. The queue issue 1 is about. */
export const ranked = ledger =>
  ledger.map(e => ({ entry: e, ...rank(e) }))
        .filter(r => r.eligible)
        .sort((a, b) => b.rank - a.rank || a.entry.query.localeCompare(b.entry.query));

/** The ledger entry a published post came from, or null. */
export const entryForSlug = (ledger, slug) => ledger.find(e => e.slug === slug) || null;
