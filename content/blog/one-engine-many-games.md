---
title: One engine, many games
date: 2026-09-01
order: 1
description: Six word puzzles built as six copies of one game. What it cost, and what an app directory looks like once the game moves out of it and only identity stays behind.
tags: [gamedev, architecture, monorepo, capacitor]
devto: true
linkedin: false
draft: false
---

*Part 1 of 10 on building a word-block puzzle engine. [Series index at the bottom.](#the-series)*

The second game was a copy of the first. That is not a confession, it is what everybody does,
and for about six weeks it is the correct decision — you do not know which parts are the game
and which parts are that game until you have built a second one.

The bill arrives later. I fixed a rounding bug in the star calculation, shipped it, and then
found the same bug sitting untouched in the sibling title, because the sibling was a folder
copy from before the fix existed. The fix took four minutes. Finding out the other game had it
took three weeks, because nothing told me.

## What a copy actually costs

The honest number is not "duplicate code". It is the number of places a decision lives.

At the point I stopped, one game's `src/` held **70 files**: screens, the board renderer, the
store, hooks, the economy, the difficulty tiers, the sound layer, the ad wiring. The other
game held 70 files that were 90% the same, drifting apart one hotfix at a time.

Every one of those pairs is a place where two games can disagree. Not in theory — in practice,
what diverged first was exactly the stuff nobody looks at twice:

- The interstitial cooldown, changed in one game after a review complaint.
- The daily-chest table, retuned in one game and not the other.
- A `catalog.json` fetch that got an error handler in one game after a crash report.

None of those are interesting enough to remember to port. All of them are the kind of thing
that turns two products into two codebases.

## The split I landed on

There is a package that is the game, and an app directory per published title that is
*nothing but identity*.

```
packages/word-engine/     the game itself — 92 files
apps/<title>/src/          3 files
```

Three files. That is the whole shell:

```
src/main.jsx     mount the engine, hand it the content source
src/brand.js     turn brand.json into what the engine reads
brand.json       this build, as data
```

Everything else in an app directory is not code: an icon source, a board pack under `public/`,
a generated `android/`, a `capacitor.config.json`. The parts a designer or a store listing
would change, and none of the parts a bug lives in.

## brand.json is data, deliberately

The temptation is to make the brand a module — a JS file exporting a config object, so you can
compute things in it. I did that first and had to undo it.

The problem is who needs to read it. The Vite config needs the board-pack directory so it can
shrink the pack on the way into `dist/`. The release script needs the app name and the store
identity. A provisioning check needs the leaderboard ids. None of those run inside the app's
module graph, and none of them should have to resolve `src/` — or a JSX transform, or an alias
— to find out what folder the boards are in.

So the declaration is plain JSON:

```json
{
  "id": "…",
  "defaultLanguage": "en-US",
  "content": {
    "stagesDir": "/stages-blocks-en",
    "dictionaryUrl": "/words-blocks-en.txt",
    "stageCount": 392
  }
}
```

and `src/brand.js` is two lines that hand it to the engine's `defineBrand()`. Interpretation
lives in the engine, where every sibling gets the same interpretation. The rule I kept
tripping over and eventually wrote down: **if a value is worth setting per game it belongs in
`brand.json`; if it needs interpreting, that belongs in the engine.**

## The alias, and why it is not a setter

The engine has to reach the brand from ninety-odd files. The obvious approach is an
initialiser — `setBrand(brand)` at the top of `main.jsx`, before rendering.

That does not work, and the failure is quiet. Several engine modules read the brand *as they
load*: the string catalogues bake the game's name into seventeen languages at import time. A
setter runs after the imports it needs to precede, so those modules capture whatever the
default was and the game ships with the placeholder name in nine of its seventeen locales.

The fix is to make it a resolution concern rather than a runtime one. The shared Vite config
points an alias at the app's own file:

```js
resolve: {
  alias: { '@brand': resolve(appDir, 'src/brand.js') },
}
```

Engine modules `import brand from '@brand'` and get this game's identity at module-evaluation
time, because that is what an alias is for. No ordering to get wrong.

## The build has to be shared too, or it isn't shared

This is the part I underestimated. You can move all the game code into a package and still end
up with a fleet, because the *build* stays per-app. The first game that needs a Vite plugin
adds it to its own `vite.config.js`, the next game copies that file, and now there are as many
build configs as there are titles — which is the thing you just spent a month removing.

An app's Vite config is now one line:

```js
export default defineGameConfig(import.meta.url)
```

`import.meta.url` rather than a path, because that is the single thing an app knows about
itself that the shared config cannot work out. Vite may load a config from a temp file
somewhere else on disk, which makes both `process.cwd()` and the shared module's own
`import.meta.url` unreliable — I found this the way everyone does, with an `ENOENT` naming a
path under `node_modules/.vite-temp/`.

The same argument applies to the native project, the release script and the pack tooling.
Those are parts 9 and 10.

## What this does not fix

Two things, and they are worth saying because the pitch for "one engine" usually skips them.

**The engine has to actually be general, and generality is a cost you pay per feature.** A
change that would have been ten minutes inside one game is now a change to a shared package,
which means asking whether the sibling wants it, and often adding a brand field so it can say
no. That is the correct amount of friction and it is still friction.

**Divergence pressure does not go away, it moves.** When a store listing needs one game to
behave differently, the pressure lands on `brand.json` — and a declaration file with forty
fields in it is a copy of the old problem, wearing JSON. I do not have a clean rule for this
yet. The one heuristic that has held: if a field would only ever have two values and one of
them is "the way it already works", it is a bug in the engine, not a brand field.

## The check that keeps a shell a shell

None of the above survives contact with a deadline unless something enforces it. The engine
ships a test suite that a shell runs against itself, and one of its assertions is simply that
the shell contains nothing but identity — no components, no store, no game logic.

```js
import { describeGameShell } from '@gamefactory/word-engine/testing'

describeGameShell(import.meta.url)
```

That is the entire test file in each app. The suites live in the engine, because a copy of the
suite in each app is a copy that drifts, and the sibling whose copy is stale is exactly the one
that ships the broken pack. Part 7 is about what else it checks.

## Was it worth it

The measurable part: adding the second title on the engine took a brand file, a board pack, an
icon and a native project. No source files. The next one will be the same, and that is the
whole return — not code reuse, which nobody can feel, but the fact that a bug fixed once is
fixed everywhere without anyone remembering to go and look.

The unmeasurable part is that I now think about "what is this game" and "what is a game" as
two different questions, and the answer to the second one is a package with a version number.

---

<h2 id="the-series">The series</h2>

1. **One engine, many games** — you are here
2. [Generate levels offline, not at runtime](/blog/generate-levels-offline-not-at-runtime/)
3. [Rating puzzle difficulty by decisions](/blog/rating-puzzle-difficulty-by-decisions/)
4. [Difficulty rates a stage, progression places it](/blog/difficulty-rates-progression-places/)
5. [The opening layout is part of the puzzle](/blog/opening-layout-is-part-of-the-puzzle/)
6. [Shipping a 4 MB level pack](/blog/shipping-a-4mb-level-pack/)
7. [Testing a level pack you did not write](/blog/testing-a-level-pack-you-did-not-write/)
8. [Pricing an economy off its difficulty model](/blog/pricing-an-economy-off-its-difficulty-model/)
9. [Cutting a Capacitor Android build in half](/blog/capacitor-android-build-apk-size/)
10. [A release pipeline you cannot forget](/blog/release-pipeline-you-cannot-forget/)
