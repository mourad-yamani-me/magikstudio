---
title: Cutting a Capacitor Android build in half
date: 2026-09-01
order: 9
description: 13.1 MB down to 5.9 MB delivered. R8 is off in the project Capacitor generates, and one library's consumer ProGuard rule was pinning 9,304 classes.
tags: [gamedev, capacitor, android, apk, r8]
draft: false
---

*Part 9 of 10 on building a word-block puzzle engine. [Part 8: pricing an economy off its difficulty model.](/blog/pricing-an-economy-off-its-difficulty-model/)*

A word puzzle with 392 levels of JSON in it was a 17 MB App Bundle. That felt like the levels'
fault. It was not — content was 16% of the download and the Android runtime was most of the rest.

After the pass below, a phone downloads **5.88 MB** where it used to download **13.09 MB**. Here
is where it went, in order of how much it was worth.

## First: stop reading the wrong number

`ls -l` on the `.aab` is not the download. Play splits a bundle per device — by screen density,
by ABI, by language — and strips its own metadata before delivery. My "after" bundle was 15.5 MB
on disk when the actual download had already halved, because R8 had added a 3.83 MB
`BUNDLE-METADATA/…/proguard.map` that Play keeps for deobfuscating crash reports and never sends
to anyone.

So the first thing to build is a way to see the real figure: sum the *compressed* entries,
discard `BUNDLE-METADATA/` and `META-INF/`, and keep one density bucket. It needs nothing but
`unzip`:

{{gist:delivered-size.mjs}}

```
.aab on disk        16.83 MB
delivered (xxhdpi)  13.09 MB
     3.01 MB  base/dex/classes2.dex
     2.90 MB  base/dex/classes.dex
     2.71 MB  base/dex/classes3.dex
     1.65 MB  base/assets/public          ← the whole web app + 392 levels
     0.93 MB  base/dex/classes4.dex
     0.35 MB  base/res/drawable-port-xxhdpi-v4
```

Four dex files, 9.55 MB compressed, 73% of the download. The content I had been optimising was
the fourth-largest line.

## R8 is off in the project Capacitor generates

This is the single biggest item, and it is a default.

```gradle
buildTypes {
    release {
        minifyEnabled false      // ← what `npx cap add android` gives you
    }
}
```

Nothing shrinks. Every class of Play Services, Firebase, gRPC and Guava ships whole. Turning it
on:

{{gist:release-build.gradle}}

Dex went **9.55 MB → 4.24 MB** compressed. Delivered download 13.09 → 7.76 MB, from four lines of
Gradle.

Capacitor itself is safe under R8: the Android library ships `consumerProguardFiles`, so
`@CapacitorPlugin` classes and anything extending `Plugin` are kept automatically. What is not
kept automatically is the `@JavascriptInterface` object you added by hand to `MainActivity` —
`proguard-android-optimize.txt` covers it, but I repeat the rule locally because losing it is a
silent, release-only failure where a bridge method just returns `undefined`.

The one thing that broke the build first time was a library referencing an SDK that is not a
dependency:

```
ERROR: R8: Missing class com.facebook.CallbackManager$Factory
  (referenced from: …FacebookAuthProviderHandler…)
```

The Firebase authentication plugin compiles in a handler for every provider it supports. The app
offers two of them. `-dontwarn com.facebook.**` and it builds — R8 writes the exact rules you
need into `app/build/outputs/mapping/release/missing_rules.txt`, so this is a copy-paste, not an
investigation.

## The consumer rule that undid most of it

Then Play's app-optimisation report scored the bundle at **28% optimised**, with R8 on. That
number sent me looking for what R8 was not allowed to touch.

`firebase-auth` 24.0.1 shipped this consumer rule inside the AAR:

```
-keep class com.google.android.gms.internal.** { *; }
```

Every Play Services internal class. Not the auth ones — all of them. **9,304 classes** pinned
unshrunk and unrenamed, by a dependency, in a file I never wrote and would not have thought to
look in.

Firebase BOM 34.x pulls `firebase-auth` 24.2.0, which narrows that rule to the one proto base
class it actually needed.

The lesson generalises past this one library: **a consumer ProGuard rule is a dependency's
ability to disable your optimisation, and nothing in your build tells you it happened.** If the
numbers are worse than they should be, unzip the AARs and grep for `-keep`.

While I was in there, two lines that Play's report also checks:

{{gist:proguard-rules.pro}}

Flattening renamed classes into the root package is worth real bytes — every package name is a
string in the dex pool, and 15,000 classes spread over hundreds of packages is a lot of strings
nothing reads at runtime.

## The web SDK that can never run

The JavaScript side had a version of the same problem: code that is unreachable but present.

Every service picks its provider at runtime — `Capacitor.isNativePlatform()` chooses the native
plugin, otherwise the `firebase/*` web SDK — and imports **both arms statically**. So a build
destined for the Play Store carried a full copy of the Firebase JS SDK that the device can never
execute.

Worse, and this is the part I did not predict: every `@capacitor-firebase` plugin registers a
browser fallback as

```js
registerPlugin('FirebaseAuthentication', {
  web: () => import('./web').then(m => new m.FirebaseAuthenticationWeb()),
})
```

`registerPlugin` only calls that on a browser. But it is a static import site, so the bundler has
to emit it, and each of those `web.js` files pulls in its slice of the web SDK. That is where the
525 KB Firestore chunk and the 168 KB Auth chunk in my build were coming from — not from my code
at all.

The fix is a small Vite plugin that, under a `VITE_NATIVE=1` flag, resolves both the web-only
service arms and those plugin fallbacks to stubs that throw. Main chunk **909 KB → 433 KB**, and
the two large chunks disappeared entirely.

{{gist:drop-web-firebase.js}}

The part I would insist on if I wrote it again is the assertion. A stub only helps while nothing
re-imports the real thing, so the plugin scans the emitted chunks and fails the build if
`@firebase/` appears anywhere:

```
VITE_NATIVE=1 but the Firebase JS SDK is still in assets/index-xxx.js.
Something imports it outside the stubbed entry points.
```

Without that, the next dependency upgrade quietly puts 700 KB back and nobody finds out.

## PNG splash screens are a terrible idea

`@capacitor/assets` generates a splash image per density, per orientation, per theme. 26 PNGs.
The portrait xxhdpi one was **457 KB**.

A full-bleed smooth gradient is close to the worst case for PNG's row filters. The same image as
WebP at quality 88 is **28 KB**, and I could not tell them apart side by side at full size.

```
res/  7.0 MB → 1.1 MB
```

The Android drawable system does not care about the extension — `@drawable/splash` resolves to
`splash.webp` exactly as it resolved to `splash.png` — so this is a change to the generator
script and a deletion, with no XML to touch. WebP drawables have been supported since API 18;
the minimum here is 24.

Launcher mipmaps got the same treatment for another 30 KB per density bucket, with the monochrome
themed-icon layer going lossless because it is flat white on alpha.

## The last 150 KB

Play Services and Firebase package their `.proto` sources and a pile of build metadata as Java
resources. Android reads none of it — these SDKs use generated Java classes, not runtime
descriptor parsing. The `packaging { resources { excludes } }` block in the Gradle file above
drops it: **164 KB → 15 KB**.

## Verify it on a device, not in a report

R8 breaks things by removing code that is only reached reflectively, and the failure is at
runtime in the release variant — the one build nobody runs during development.

So: `ionic capacitor build android release`, install the signed APK, and play it. In my case
`logcat` showed anonymous sign-in succeeding and the backend answering, which is the proof that
mattered; a green build proves only that R8 finished.

If you normally run `capacitor build android app` or `ionic capacitor android build` through the
CLI, note that neither assembles a *release* variant on its own. The size questions all live in
`assembleRelease` / `bundleRelease`, so a debug `capacitor android build apk` will not show you
any of this — debug builds have `minifyEnabled false` by design and always will.

## Where it ended up

| | before | after |
| --- | --: | --: |
| dex | 9.55 MB | 4.24 MB |
| web assets | 1.65 MB | 1.10 MB |
| splash + icons | 1.15 MB | 0.13 MB |
| SDK metadata | 0.16 MB | 0.02 MB |
| **delivered (xxhdpi)** | **13.09 MB** | **5.88 MB** |

The remaining dex is mostly the ads SDK, which is the cost of the business model rather than a
mistake. I looked at the lite variant and decided not to gamble ad revenue on it.

The release script now prints the delivered estimate against a budget on every build, because the
whole point of doing this once is not having to do it again from scratch when something large
comes back.

---

**Next:** part 10, [a release pipeline you cannot forget a step in](/blog/release-pipeline-you-cannot-forget/) — generated native projects, and the version number that reset itself to 1.
