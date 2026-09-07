---
title: What AdMob Unity mediation adapter status means
date: 2026-09-10
description: Three mediation adapters showed up NotReady in a project with no mediation installed. I installed one for real to find out which field actually tells you anything.
tags: [unity, android, admob, gamedev]
keySections: [Read the description, not the state, Two errors on the way in]
devto: true
linkedin: false
---

A while back I initialised the Google Mobile Ads SDK in a Unity project with no mediation set
up at all, and the callback handed me this:

```
adapter com.google.android.gms.ads.MobileAds = Ready
adapter com.google.ads.mediation.vungle.VungleMediationAdapter = NotReady
adapter com.google.ads.mediation.applovin.AppLovinMediationAdapter = NotReady
adapter com.google.ads.mediation.adcolony.AdColonyMediationAdapter = NotReady
```

Three adapters I had never installed, all reporting `NotReady`. That looks like a broken
mediation setup, and people rewrite their configuration over it. So I installed one properly
and compared.

This continues the lab from the [AdMob SDK post](/blog/admob-unity-sdk-empty-app-id/): Unity
6000.4.0f1, a Pixel 9 Pro emulator on Android 16. The adapter is Liftoff Monetize 5.7.7 —
Vungle, renamed — which is one of the three in that list.

It is worth saying what this post is not. If you came from `admob unity integration`,
`admob unity tutorial`, `admob unity guide` or `how to integrate admob in unity`, the
walkthrough for getting the SDK into a project and building an APK is
[that post](/blog/admob-unity-sdk-empty-app-id/), not this one, and `admob unity github` will
take you to the plugin source. This one picks up afterwards, at the line in your log naming
ad networks you have never heard of.

## Read the description, not the state

`AdapterStatus` has an `InitializationState` and a `Description`. Everyone logs the state. The
description is the field that carries the information. With the Liftoff adapter genuinely
installed:

```
adapters=4
com.google.android.gms.ads.MobileAds                       = Ready    ()
com.google.ads.mediation.vungle.VungleMediationAdapter     = NotReady (Timeout.)
com.google.ads.mediation.applovin.AppLovinMediationAdapter = NotReady (Failed to create Adapter.)
com.google.ads.mediation.adcolony.AdColonyMediationAdapter = NotReady (Failed to create Adapter.)
```

All three still say `NotReady`. But the one I installed says **`Timeout.`** and the two I did
not say **`Failed to create Adapter.`**

That is the distinction:

- **`Failed to create Adapter.`** — the adapter class is not in your build. The SDK knows the
  name, tried to instantiate it, and there was nothing there. Nothing is wrong. This is what
  every uninstalled adapter looks like.
- **`Timeout.`** — the adapter is present and ran, and did not finish initialising. Now you
  have something to fix.

So the log that started this was never evidence of a problem. `play-services-ads` enumerates
adapters it has heard of, and reports on the ones that are absent in exactly the same `NotReady`
state as the ones that are broken. Log the description or the state alone will mislead you:

```csharp
foreach (var kv in status.getAdapterStatusMap())
    Debug.Log($"{kv.Key} = {kv.Value.InitializationState} ({kv.Value.Description})");
```

Mine timed out for a reason logcat was happy to explain:

```
W/VungleMediationAdapter: Multiple 'appid' entries found:
  [fake-vungle-app-id, 54d153ece5b12c181f0000b4].
  Using 'fake-vungle-app-id' to initialize the Vungle SDK.
```

I have no Liftoff account, so AdMob served a placeholder app id and the adapter dutifully tried
to initialise the Vungle SDK with the string `fake-vungle-app-id`. Which is honest of it.

## Two errors on the way in

Installing the adapter is where the time actually goes. Both failures below are exact.

**The scoped registry was too narrow.** The adapters live on OpenUPM, and the obvious scope is
the one matching the package name:

```json
"scopes": ["com.google.ads.mobile"]
```

```
An error occurred while resolving packages:
  com.google.external-dependency-manager (dependency):
  Package [com.google.external-dependency-manager@1.2.186] cannot be found
```

Exit code 1 in 22 seconds, never reaching the build. The adapter depends on the plugin, and
the plugin depends on the External Dependency Manager, which is a different scope. Add it:

```json
"scopes": ["com.google.ads.mobile", "com.google.external-dependency-manager"]
```

**Then the two install methods collided.** My project already had the plugin installed from
`GoogleMobileAds-v11.5.0.unitypackage`, under `Assets/`. The adapter pulls
`com.google.ads.mobile@11.0.0` from UPM, under `Packages/`. Same files, two homes:

```
result=Failed  errors=238
GUID [c0080e86890c24abba53b3f4d2daf6db] for asset
  'Packages/com.google.ads.mobile/GoogleMobileAds/Editor/AndroidBuildPreProcessor.cs'
  conflicts with: …
Found plugins with same names,
  Packages/com.google.ads.mobile/Plugins/Android/googlemobileads-unity.aar and
  Assets/Plugins/Android/googlemobileads-unity.aar.
  Delete the one of the duplicate plugins.
```

238 errors. Pick one install method. I deleted the `Assets/` copy and let UPM own it, keeping
`Assets/GoogleMobileAds/Resources/GoogleMobileAdsSettings.asset`, which holds the App ID and is
not part of the package.

## The downgrade nobody mentions

Watch what the resolver wrote into `mainTemplate.gradle` afterwards:

```gradle
implementation 'com.google.ads.mediation:vungle:7.7.4.0'
implementation 'com.google.android.gms:play-services-ads:25.0.0'
```

`25.0.0`. Before the switch, the `.unitypackage` at 11.5.0 was resolving
`play-services-ads:25.4.0`. Taking the OpenUPM route moved me back four minor versions of the
ads SDK, because the adapter pins `com.google.ads.mobile@11.0.0` and that is what 11.0.0 asks
for. Nothing warns. If you are on a recent `.unitypackage` and add a mediation adapter from
OpenUPM, check the resolved version afterwards.

## What it costs

I nearly published a wrong number here. Comparing the mediation build against my earlier APK
suggested the adapter cost about 11 MB, which would be alarming — but those two builds also
differed in build type and plugin version. With a proper control, same UPM plugin, same
development build, only the adapter changing:

| | APK bytes |
| --- | --- |
| Plugin only | 30,188,822 |
| Plugin + Liftoff Monetize | 30,962,294 |

**773,472 bytes, 0.74 MiB, +2.6%.** One adapter is cheap. The point generalises: if two builds
differ in more than one thing, the difference between them is not a measurement.

## What I did not test

A mediation adapter with real credentials, actually filling. That needs a Liftoff account and
a configured waterfall in the AdMob console, so I cannot tell you anything about fill, latency
or revenue. Everything above is about getting the adapter into the build and reading what the
SDK says about it.

## Takeaway

Log `Description` alongside `InitializationState`, because on its own the state cannot
distinguish an adapter you never installed from one that is failing. `Failed to create
Adapter.` on a network you do not use is the correct, healthy output, and it is not worth a
single minute of debugging.
