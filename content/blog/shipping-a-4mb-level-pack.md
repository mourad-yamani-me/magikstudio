---
title: Shipping a 4 MB level pack
date: 2026-09-01
order: 6
description: 392 levels of JSON, pretty-printed for review and minified for the store. The Vite plugin that does it, and the hook choice that hid a real error.
tags: [gamedev, capacitor, vite, performance]
code: https://gist.github.com/IndieCoreDev/788e88e15747179b5ee493057be4821e
codeLabel: The plugin, both fixes included
devto: true
linkedin: false
draft: false
---

*Part 6 of 10 on building a word-block puzzle engine. [Part 5: the opening layout.](/blog/opening-layout-is-part-of-the-puzzle/)*

The level pack is 395 JSON files: 392 boards, a catalogue, an index, and a build record. On disk
in the repo it is **4.37 MB**, and every byte of that was in the app I first put on the store.

None of it needed to be.

## Pretty in the repo, minified in the store

The boards come out of the generator pretty-printed, and they should. They are reviewed in pull
requests, diffed when the generator changes, and read by hand when a board plays wrong. A
minified 11 KB board file is not something anyone can look at.

But nothing reads that whitespace at runtime. It is **45% of the pack**:

```
stage pack 4.37 MB -> 2.36 MB
```

So the shrink happens on the way into the build output, never in `public/`. The repo copies stay
diffable, the shipped copies are one line each, and no one has to remember which is which.

While it is in there, it deletes `index.json` — 92 KB that is the generator's own build record.
The game only ever fetches `catalog.json` and individual boards. It took grepping the whole
engine to be sure of that, which is a reminder that "which of these files does the app actually
open" is worth asking of any content folder.

## The hook choice, and the error it hid

The plugin started on `closeBundle`. That was wrong twice.

The first failure was mundane: Vite may load a config from a temp file elsewhere on disk, so
`import.meta.dirname` pointed at `node_modules/.vite-temp/`. The out directory has to come from
the resolved config instead, via `configResolved`.

The second failure cost real time. `closeBundle` **also fires when the build has failed**. So a
genuine error — an import that could not be resolved — tore down the bundle, my hook ran against
a `dist/` that had never been created, and the only thing printed was:

```
[shrink-stage-pack] ENOENT: no such file or directory,
    scandir '…/dist/stages-blocks-en'
```

I spent twenty minutes debugging the plugin. The plugin was fine; it was standing on top of the
real error.

`writeBundle` is the correct hook and it fixes both. It runs only on a successful write, and Vite
copies `publicDir` into `outDir` *before* the write phase, so the files are already there.

The general shape of this bug is worth carrying: **a cleanup hook that runs on the failure path
and throws will replace every error with its own.** If you write one, either guard it or pick a
hook that does not run when things went wrong.

The whole plugin, both fixes included:

{{gist:shrink-stage-pack.js}}

## Which folder? Ask the brand

The first version had the pack directory hard-coded. That is fine with one game and wrong with
two, since the sibling ships a different language pack under a different folder name.

The plugin takes it from the game's `brand.json` instead — the same declaration the app hands
the engine at startup. One plugin, in the shared build config, and every game on the engine gets
it without carrying a copy with its own folder name baked in.

## What it is worth in the download

Compressed inside an Android App Bundle, the pack is **0.61 MB** and the dictionary another
**0.33 MB**. Against a total delivered download of 5.88 MB, content is about 16%.

That ratio is the useful thing to know. Before I measured it I assumed the level data was the
problem and the code was fine. It was the other way round by a factor of four — the Android
runtime was the problem, which is part 9. Minifying the pack was worth doing and it was not
where the download was going.

## Loading: one board at a time

The runtime side is deliberately boring.

At startup the game fetches `catalog.json` — one small file with every board's identity and
rating, enough to build the whole campaign order without touching a single board. Boards are
~11 KB each and are fetched when a level opens, then cached.

The catalogue is fetched rather than imported. That matters more than it sounds: bundling it
would let a stale copy survive in `src/` after the pack was rebuilt, and the failure mode is a
campaign ordered from ratings that no longer match the boards being played.

The dictionary is 877 KB and is read as a **string**, not parsed. It is packed one line per word
length:

```
3=aahabaabbabcabyaceactadd…
4=…
```

Ten lines. A word costs exactly its letters, lookup is an offset and a slice, and nothing builds
a hundred thousand objects on the main thread while the player waits. That format came from
measuring: `JSON.parse` on an equivalent object map was the single slowest thing in startup.

## What I would do differently

Two things.

**Measure before optimising the obvious thing.** I minified the pack first because it was the
biggest number in `du -sh`. The biggest number in `du -sh` is not the biggest number in the
download, because everything in the bundle is compressed and JSON compresses extremely well.
2 MB of saved JSON became about 0.4 MB of saved download.

**Put the size in the pipeline.** The plugin prints its before and after on every build. That
line is how I noticed, months later, that a pack rebuild had shipped 30 extra boards nobody had
mentioned. A number printed on every build is a regression test that costs nothing.

---

**Next:** part 7, [testing a level pack you did not write](/blog/testing-a-level-pack-you-did-not-write/) — the suite that walks all 392 boards to a solve before any of them reach a player.
