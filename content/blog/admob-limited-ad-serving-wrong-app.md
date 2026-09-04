---
title: AdMob limited ad serving on the wrong app
date: 2026-09-05
description: I created a second AdMob app for a game that already had one. The listing link went to the empty app, the app I was shipping got limited ad serving, and only one of them could be fixed without a release.
tags: [google-play, admob, android, release]
devto: true
linkedin: true
linkedinText:
  - A Play Store listing links to exactly one AdMob app. I found that out after creating a second one for a game I had already shipped.
  - The verified app had no ad units. The app with all the ad units could not be verified, because the listing it needed was taken. Ad serving stayed limited on the one that was actually running.
  - Writing up which way out I picked, why the other one was cheaper, and the two things that made the fix cost a release instead of a checkbox.
draft: false
---

[Logo Quiz: Guess Brand](/games/logo-quiz-guess-brand/) is Android-only and has been on Play
for a few versions. At some point I created a second AdMob app for it. I no longer remember
why — probably to start clean after fumbling something in the first one.

The result was **AdMob limited ad serving** on the game that was actually live — ads coming
from an app AdMob would not verify, next to a verified app with nothing in it, and no way to
swap them from the Play Console.

## What "limited" actually means here

AdMob will happily give you an app ID and ad unit IDs before it knows the app exists in a
store. Until you link that AdMob app to its store listing, it stays unverified, and unverified
apps get **limited ad serving** — low fill, low eCPM, no programmatic demand. The ads are not
off. They are just worth very little, which is harder to notice than an outage.

It is worth being precise about which limit this is, because the phrase is overloaded. Search
for **admob limited ads** and most of what comes back is the Policy centre kind: a violation, a
suspension, a temporary ad serving limit placed on your AdMob account while somebody reviews it.
That was not my problem, and nothing below will lift one. Mine was the boring administrative
kind — an app nobody had ever linked to a store listing — and the fix has nothing to do with
policy.

## The rule nobody states until you hit it

**A Play Store listing links to exactly one AdMob app.**

That single sentence is the whole problem. My second AdMob app had claimed the Logo Quiz
listing and been verified. My first AdMob app — the one whose IDs were compiled into the APK
people had actually installed — could not be linked, because the listing it needed was already
spoken for. AdMob does not offer to move the link. The console simply does not show the
listing as available any more.

So there were two apps, and each was missing exactly what the other had:

| | App A (in the build) | App B (linked) |
| --- | --- | --- |
| Ad units | banner, interstitial, rewarded | none |
| Store listing | cannot link — taken | linked and verified |
| Ad serving | limited | nothing to serve |

## How to remove the AdMob app ad serving limit

For the verification kind, there are two ways, and the cheap one is not the obvious one.

**Delete App B.** It had no ad units, so there was nothing in it to lose. Deleting or
unlinking it frees the listing, and App A — already shipping, already wired up — can then be
linked and verified. No code change. No new release. The version already on people's phones
starts serving properly once verification goes through.

**Or move to App B.** Create the three ad units there, swap four IDs in the project, build,
upload, and wait for players to update.

I recommended the first one. We went with the second — the three ad units in App B got created
while we were still deciding, and at that point shipping a release we were going to ship anyway
felt easier than unpicking it.

I still think deleting the empty app is the better default. It is the option with no tail:
nothing to roll out, nothing to wait for, no window where half your installs are on old IDs.

## What the swap actually cost

Four IDs, and I would have got it wrong if I had only changed the obvious ones.

The app ID lived in **two** places, not one. There is the `react-native-google-mobile-ads`
block in `app.json`, which is the one you find first:

```json
"react-native-google-mobile-ads": {
  "android_app_id": "ca-app-pub-3940256099942544~3347511713"
}
```

And there is the same ID again in `AndroidManifest.xml`, carrying a `tools:replace` so that it
wins the manifest merge:

```xml
<meta-data
  android:name="com.google.android.gms.ads.APPLICATION_ID"
  android:value="ca-app-pub-3940256099942544~3347511713"
  tools:replace="android:value" />
```

The ID in both blocks is Google's published sample app ID rather than mine, which is redacted.
The shape is the part worth copying.

Change only `app.json` and the build still succeeds — with the old app ID baked into the APK,
because the manifest entry is the one that ends up in the package. That is a silent wrong
answer, which is the kind I care about most.

So I stopped trusting the source and checked the artifact instead. The app ID is readable
straight out of the bundle:

```
unzip -p app-release.aab base/manifest/AndroidManifest.xml | strings | grep -o "ca-app-pub-[0-9]*~[0-9]*"
```

One line, and it answers the only question that matters: what did I actually ship.

The other cost is the one that keeps arriving. Because the fix travels inside a release, it
spends a `versionCode` — the swap went out as 1.0.10. Then a second pass at the same build,
later the same night, needed an upload of its own, and 10 was gone. Play rejects a re-used
number, so that became 1.0.11.

Nothing about that is hard. It is just a cost that only exists because I chose the option that
needs a release. Deleting the empty AdMob app would have spent no version numbers at all,
because it changes nothing in the build.

One thing that did not cost anything: the publisher ID was the same for both apps, so
`app-ads.txt` never had to change. If you end up moving between two different AdMob accounts,
that file does need updating, and it is a separate way to end up with poor fill.

## You cannot check this on an emulator

I installed the release build on an emulator to confirm the banner still loaded, and it did —
labelled **Test Ad**.

That is not a bug and not a configuration mistake. AdMob treats emulators as test devices
unconditionally, so a "Test Ad" is the correct and only outcome there. It proves the SDK
initialised and the ad unit was requested. It proves nothing whatsoever about whether the
limit has lifted.

The actual verification is in the AdMob console: the app has to stop showing a prompt to link
a store listing. If it still shows one, shipping the release changed nothing about the
**admob limited ad serving** state, and you have spent a release finding that out.

## What I would do differently

Create the AdMob app once, and link it to the Play listing before wiring a single ID into the
build. The linking step is free at that point and expensive later, because later means the
listing is claimed by whichever app you created first — including the one you have decided to
abandon.

And if a second app already exists, look at which of the two is empty before deciding which
one to keep. The instinct is to keep the app you have already integrated. The cheaper move is
usually to delete the one with nothing in it and let the app you already shipped inherit the
listing it should have had.
