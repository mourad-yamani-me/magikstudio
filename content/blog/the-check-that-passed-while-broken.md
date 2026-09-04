---
title: The check that passed while broken
date: 2026-09-01
description: Two checks in my build were green for months while testing nothing. One was switched off by a guard clause, the other by a missing space in a regex.
tags: [ci-cd, testing, workflow, ai]
code: https://gist.github.com/IndieCoreDev/6c707bf89e5d215225f3bdac6e4a4b25
codeLabel: The verifier, with both checks fixed
devto: true
linkedin: false
draft: false
---

I wrote [a verifier that reviews my code so I don't have to](/blog/build-reviews-ai-code/).
It has grown since. Every rule in it exists because something got past me once, which is the
only rule I have for adding rules.

Working through a batch of changes recently I found two of those rules had stopped checking
anything. Not failing — passing, on every build, while testing nothing. One had been that way
for months. The other I introduced and shipped in the same afternoon.

Neither is an interesting bug. That is rather the problem with them.

## One: a guard clause that turned into an off switch

My privacy policy claims the site writes exactly one thing to your device and names it. That
is checkable, so it is checked: read the JavaScript bundle, pull out every storage key, and
fail if the policy does not mention one.

```js
const appJs = path.join(DIST, 'assets/app.js');
const pri   = path.join(DIST, 'privacy/index.html');
if (fs.existsSync(appJs) && fs.existsSync(pri)) {
  // …extract keys, compare against the policy…
}
```

Reasonable-looking defensive code. Then I fingerprinted the bundle for cache-busting, so
`app.js` became `app.4ba98ea8.js`, and `fs.existsSync` started returning false.

The check did not fail. There was nothing to fail on. The `if` was false, the block never
ran, and the build printed `passed — 0 errors` exactly as it always had. A promise in a legal
document went unguarded and the only signal was an absence.

The fix is to resolve the file by shape, and to treat a missing bundle as an error rather
than as permission to skip:

```js
const bundles = fs.readdirSync(path.join(DIST, 'assets'))
  .filter(f => /^app\.[0-9a-f]+\.js$/.test(f));
if (bundles.length !== 1)
  fail('/assets/', `expected exactly one app.<hash>.js bundle, found ${bundles.length}`);
```

The general shape: `if (thing exists) { check it }` is a check that disables itself the day
the thing moves. If the thing not existing is itself a problem, say so.

## Two: a space

Later the same week I added a check that every font weight has a metric-matched fallback.
It parses `@font-face` blocks out of the built CSS:

```js
const faces = [...css.matchAll(/@font-face\{([^}]*)\}/g)];
```

Green immediately. I deleted a fallback on purpose to watch it complain, and it stayed green.

My build produces the font CSS two ways. The stylesheet is minified through a
`.replace(/\s+/g, ' ')` pass, which leaves `@font-face { … }` with a space before the brace.
The fallback rules are generated as strings by the same script, already compact, and come out
as `@font-face{…}` without one.

```
$ grep -o '@font-face[ ]\?{' dist/index.html | sort | uniq -c
   4 @font-face {
   3 @font-face{
```

My regex matched three of the seven. It could see the rules I was generating and none of the
real ones, so "is every declared weight covered" was comparing a list against itself. Adding
`\s*` fixed it. The sabotage then produced what I wanted the first time:

```
ERROR  fonts: Plus Jakarta Sans 600 has no metric-matched fallback — its swap
       will shift layout
```

## Sabotage is the only evidence

Both of these passed code review, because both are correct-looking code. Both passed the
build, because passing is what they were doing wrong. There is no output to inspect and no
red line to notice. A check that runs and finds nothing looks identical to a check that
cannot find anything.

So the habit I have landed on: after writing a check, break the thing it protects and watch
it scream. Then put it back. It takes about a minute and it is the only step that
distinguishes a check from a comment.

```
$ npm run check | grep ERROR | head -2
  ERROR  /legal/index.html: .toc is styled by 8 selector(s) in src/styles.css
         but only 1 survived this page's inlined CSS
```

That is a check I trust, because I have seen it work. Nine went into the build during this
round of changes and every one of them was confirmed the same way — including a couple that
needed fixing first, of which one is described above.

It matters more with a model writing the code. Not because the code is worse — most of it is
fine — but because it arrives faster than I can read it properly, and the thing I have
substituted for reading is the build. Every check I do not verify is a hole in the substitute,
and holes in it are invisible by construction.

The nastiest version is the one that starts working and quietly stops, like the first example
here. It passed for months. Nothing changed about the check. Something changed underneath it,
in a different commit, for an unrelated reason, and no one was ever going to be told.
