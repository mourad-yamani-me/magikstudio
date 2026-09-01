---
title: A release pipeline you cannot forget
date: 2026-09-01
order: 10
description: The Android project is generated, not committed — which reset the version code to 1 and nearly made the app un-updatable. Plus the checks worth failing on.
tags: [gamedev, capacitor, android, release, gradle]
devto: true
draft: false
---

*Part 10 of 10 on building a word-block puzzle engine. [Part 9: cutting a Capacitor Android build in half.](/blog/capacitor-android-build-apk-size/)*

The last part is the least interesting to build and the one that has saved me the most: what
happens between "the game works" and "the artifact is on the store".

Every check below exists because something got past me once.

## android/ is generated, not committed

Capacitor's `android/` directory is scaffolding it wrote. Committing it means a Capacitor or AGP
upgrade is a hand-merge, per game, forever — and my two games had already diverged in their
Gradle files by the time I noticed.

So it is not committed. It is regenerated, then overwritten from templates every game shares:

```bash
cd apps/<game>
npx cap add android        # once, or after rm -rf android
npx game-native android    # apply the shared templates
```

The templates carry everything from part 9 — the R8 block, the packaging excludes, the ProGuard
rules — plus the manifest, the signing config and the Gradle properties. An upgrade is one
template edit and a regenerate per game.

Placeholders get substituted per game: application id, version, and the prefix for the signing
properties.

## The version code that reset itself to 1

This is the one that nearly cost me the app.

`android/app/build.gradle` holds `versionCode`, and it is the file Play reads, so it was the
source of truth. Reasonable, and correct right up until `android/` became a generated directory.

The first `rm -rf android && npx cap add android` reset the version code to **1**.

Play refuses an upload whose version code is not higher than the last one it accepted. The app
was at build 9. There is no way to lower that ceiling, no support ticket that resets it, and a
generated file cannot carry the number across a regenerate. Had I not caught it before uploading,
that package name could never have been updated again.

The number now lives in `package.json`, which survives a regenerate, and the template takes it as
a substitution:

```json
{ "version": "1.0.6", "buildNumber": 10 }
```

`build.gradle` and the Xcode project are mirrors, written by the release script, never edited by
hand. The general rule I took from it: **a value that must survive forever cannot live in a file
you delete.** Obvious in hindsight, invisible while writing the generator.

## Blockers and warnings are different things

The release script refuses to build on some findings and merely prints others. That split took me
two attempts to get right.

The rule I settled on: **a blocker is something that gets baked into the artifact and cannot be
walked back once it is on a track.** A warning is something wrong elsewhere in the repo that this
build does not carry.

Blockers:

- A placeholder `google-services.json` — that ships a dead backend inside the bundle.
- The services file registered to a different package name than the one being built.

Warnings:

- No ad units for the platform I am not shipping today.
- A web config that only affects `npm run dev` in a browser.

Getting this wrong in the safe direction is not safe. My first version blocked on everything, and
within a fortnight I was passing `--force` reflexively, which is the same as having no checks at
all. A check you learn to override is worse than one you never wrote, because it costs you the
belief that the green ones mean something.

## Verify the bytes, not the command

Two checks in this category, and they are the ones I would port to any project.

**The build mode is stamped into the HTML.** Release builds lock levels and use live ad units,
driven by an environment variable — which means a bundle built without it looks identical from
the outside. A Vite plugin injects the answer into `index.html`:

```html
<meta name="build-mode" content="release">
```

The release script then reads that meta tag out of `android/app/src/main/assets/public/index.html`
— the copy Capacitor actually synced, not the one in `dist/` — and aborts before Gradle runs if
it says `dev`. That distinction is the entire value: a stale `dist/` from a hand-run build is
exactly the mistake it is there to catch.

**The signature is read back off the artifact.** Trusting the signing config in `build.gradle` is
trusting that Gradle read the properties it needed. An unsigned or debug-signed bundle is rejected
by Play, hours later, after an upload. `keytool -printcert -jarfile` on the finished `.aab` costs
nothing and answers the question directly.

## Signing config that does not block a new game

A small thing that mattered more than expected. The signing block reads properties from outside
the repo — the keystore password is never committed — and Gradle evaluates that block for *every*
variant.

Without a guard, a freshly scaffolded game cannot build even a debug APK until someone has
created its keystore alias. That is exactly backwards: a new game should run on a device long
before anyone thinks about releasing it.

```gradle
signingConfigs {
    release {
        if (project.hasProperty('GAME_UPLOAD_STORE_FILE')) {
            storeFile file(GAME_UPLOAD_STORE_FILE)
            …
        }
    }
}
```

A release build with the properties missing falls through to no signing config and Gradle says so
in plain language, which is the right failure and a legible one.

## A size budget, printed every time

From part 9: the `.aab` on disk is not the download. So the script computes the delivered estimate
and prints it under the file size, with a soft budget:

```
release/game-1.0.6-10.aab  9.4 MB
5.9 MB downloaded by an xxhdpi phone

! that is over the 7 MB budget — check what grew before uploading.
```

A budget, not a limit. Crossing it means something large came back, and the place to find that
out is the terminal rather than the Play console two days later. Making it fail the build would
put it in the same category as the over-eager blockers above.

## One script, every game

All of this lives in the shared tooling, run from a game's directory:

```bash
npx game-release --patch
```

Bumps the version everywhere it is mirrored, builds the web bundle with the native flags, syncs,
verifies the stamp, builds the bundle, collects it into `release/`, checks the signature, prints
the sizes.

The argument for sharing it is the same as everything else in this series, and it is the one
sentence I would keep if I had to throw the other nine parts away:

> Every check here was learned the expensive way on one game and is worth exactly as much to the
> next. A copy of the script per game is a copy that gets one of those fixes and not the others.

## The series

1. [One engine, many games](/blog/one-engine-many-games/)
2. [Generate levels offline, not at runtime](/blog/generate-levels-offline-not-at-runtime/)
3. [Rating puzzle difficulty by decisions](/blog/rating-puzzle-difficulty-by-decisions/)
4. [Difficulty rates a stage, progression places it](/blog/difficulty-rates-progression-places/)
5. [The opening layout is part of the puzzle](/blog/opening-layout-is-part-of-the-puzzle/)
6. [Shipping a 4 MB level pack](/blog/shipping-a-4mb-level-pack/)
7. [Testing a level pack you did not write](/blog/testing-a-level-pack-you-did-not-write/)
8. [Pricing an economy off its difficulty model](/blog/pricing-an-economy-off-its-difficulty-model/)
9. [Cutting a Capacitor Android build in half](/blog/capacitor-android-build-apk-size/)
10. **A release pipeline you cannot forget** — you are here
