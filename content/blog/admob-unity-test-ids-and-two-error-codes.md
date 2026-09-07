---
title: AdMob Unity test IDs, and two error codes
date: 2026-09-07
order: 2
description: I loaded the three AdMob test units in a real Unity build, then broke the ad unit ID two ways. The failures look nothing alike, and one gets mistaken for no fill.
tags: [unity, android, admob, gamedev]
keySections: [Two ways to get the ID wrong, The first launch that never fired]
devto: true
linkedin: false
---

The AdMob Unity test IDs are the same three strings everywhere, so there is not much to say
about copying them. What is worth writing down is what happens when the ID is *slightly*
wrong, because the SDK reports the two common mistakes with completely different errors and
only one of them looks like a mistake.

This is the same lab as [the previous post](/blog/admob-unity-sdk-empty-app-id/): Unity
6000.4.0f1, Google Mobile Ads 11.5.0, `play-services-ads:25.4.0`, on a Pixel 9 Pro emulator
running Android 16.

## The three that work

```csharp
const string Banner       = "ca-app-pub-3940256099942544/6300978111";
const string Interstitial = "ca-app-pub-3940256099942544/1033173712";
const string Rewarded     = "ca-app-pub-3940256099942544/5224354917";
```

All three loaded on a real device in one run:

```
LAB_AD interstitial LOADED
LAB_AD banner-test LOADED
LAB_AD rewarded LOADED
```

The app ID that goes with them is `ca-app-pub-3940256099942544~3347511713`. Note the
separator: an **app** ID uses `~`, an **ad unit** ID uses `/`. The prefix is identical, which
is what makes the next section possible.

You can confirm you are actually in test mode without an AdMob account open. The SDK says so
in logcat:

```
I/Ads: This request is sent from a test device.
```

If that line is absent and ads are still loading, the requests are live, and clicking one is
the fastest way to get an account limited.

## Two ways to get the ID wrong

I loaded two more banners in the same run. One used a well-formed unit that does not exist,
the other used the app ID where the unit belongs — the copy-paste slip the shared prefix
invites.

```csharp
const string Bogus     = "ca-app-pub-3940256099942544/0000000000";
const string Malformed = "ca-app-pub-3940256099942544~3347511713";  // app ID, wrong place
```

The results, verbatim:

```
LAB_AD banner-malformed FAILED code=1 domain=com.google.android.gms.ads
  msg=Error building request URL: Cannot determine request type. Is your ad unit id correct?

LAB_AD banner-bogus FAILED code=3 domain=com.google.android.gms.ads
  msg=Publisher data not found. <https://support.google.com/admob/answer/9905175#9>
```

Two different codes, and the difference matters more than it looks.

**Code 1 is honest.** The SDK could not even build a request, and the message asks you the
right question. You will fix this one in a minute.

**Code 3 is the trap.** Code 3 is `ERROR_CODE_NO_FILL` — the same code you get on a healthy
integration when the network genuinely has no ad to serve. A new app with a correct setup
sees plenty of it, so the reasonable reading of a code 3 is "no inventory yet, check back
later". Here it was produced by an ad unit ID that does not exist, and the only thing telling
the two apart is the message text.

So read the message, not the code. `Publisher data not found` means the unit is wrong or does
not belong to your account. A real no-fill does not say that.

## The first launch that never fired

Before any of that, the run nearly produced nothing at all. On a freshly booted emulator I
installed the build, launched it, and waited four and a half minutes. The process was alive,
the activity was `topResumedActivity`, Play services had logged
`Initialized AdMob in container 26.26.34`, and my `MobileAds.Initialize` callback had not
fired once.

```bash
adb shell am force-stop com.indiecore.admoblab
adb shell am start -n com.indiecore.admoblab/com.unity3d.player.UnityPlayerGameActivity
```

Every callback landed within a minute of the second launch. Same APK, same emulator, one
force-stop between them.

I have no mechanism to offer for that and I am not going to invent one — I did not
instrument the SDK's internals, so anything I said about *why* would be a guess dressed as a
finding. What I can say is the practical part: on a cold device or a fresh emulator, a first
launch that produces no ad callbacks is not yet evidence of anything. Force-stop it, launch
it again, and judge the second run. I had written most of a bug report before I tried the
obvious thing.

## What I did not test

Real ad unit IDs from a live account. Everything above uses Google's sample units, so none of
it says anything about fill rates, eCPM, mediation behaviour or what a policy-limited account
does. Those need a real AdMob account and real traffic, and a post claiming to have measured
them from an emulator would be worth nothing.

## Takeaway

Keep the test IDs in a constant, not inline at the call site, so switching to real ones is one
edit and one diff to review. Check for `This request is sent from a test device.` in logcat
before you tap anything. And when a load fails, read the message rather than the code —
`code=3` alone will send you off investigating an inventory problem you do not have.
