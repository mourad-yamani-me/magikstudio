# Cutting a Capacitor Android download in half

13.09 MB -> 5.88 MB delivered, on a WebView game with 392 levels of JSON in it.

```
dex             9.55 MB  ->  4.24 MB     R8 on
web assets      1.65 MB  ->  1.10 MB     the SDK the app cannot run
splash + icons  1.15 MB  ->  0.13 MB     PNG -> WebP
SDK metadata    0.16 MB  ->  0.02 MB     packaging excludes
```

## Files

| File | What it is |
| --- | --- |
| `release-build.gradle` | The release block `npx cap add android` does not give you |
| `proguard-rules.pro` | Keep rules R8 cannot infer, for a Capacitor app |
| `delivered-size.mjs` | What a phone actually downloads from an `.aab` |
| `drop-web-firebase.js` | Vite plugin: stub the SDK a native build can never execute |

## Read the right number first

`ls -l` on the `.aab` is not the download. Play splits a bundle per density, ABI and language,
and strips its own metadata. Turning on R8 *adds* a multi-megabyte `proguard.map` under
`BUNDLE-METADATA/` that is never delivered — so the file on disk can look barely improved while
the real download has halved.

## Things that will bite you

- **R8 is off in the generated project.** `minifyEnabled false` is the Capacitor default, so every
  class of Play Services, Firebase and gRPC ships whole. Four lines of Gradle is the single
  largest win available.
- **A dependency can disable your optimisation and nothing tells you.** One auth library shipped
  `-keep class com.google.android.gms.internal.** { *; }` as a *consumer* rule — 9,304 classes
  pinned unshrunk, and an app-optimisation score of 28% with R8 already on. If the numbers are
  worse than they should be, unzip the AARs and grep for `-keep`.
- **The first R8 build fails on a provider SDK you do not use.** Auth plugins compile in handlers
  for every provider they support. R8 writes the exact rules you need to
  `app/build/outputs/mapping/release/missing_rules.txt` — copy from there.
- **`@JavascriptInterface` on an anonymous object is a silent, release-only breakage.** The bridge
  method returns `undefined` and nothing throws.
- **PNG splash screens are enormous.** A full-bleed gradient is close to the worst case for PNG's
  row filters: 457 KB as PNG, 28 KB as WebP at q88, indistinguishable. `@drawable/splash` resolves
  to either extension, so there is no XML to change.
- **Verify on a device, in the release variant.** R8 breaks things by removing code reached only
  reflectively, and that is the one build nobody runs during development.

---

Written up in full here: **https://www.indiecore.net/blog/capacitor-android-build-apk-size/**

_A distilled snippet from a shipped engine — see the post for context._
