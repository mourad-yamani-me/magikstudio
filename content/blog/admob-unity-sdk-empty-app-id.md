---
title: The AdMob Unity SDK check that stops nothing
date: 2026-09-07
description: The Google Mobile Ads plugin says it will not build without an App ID. I left the field empty and got an APK anyway — one that dies before the first frame.
tags: [unity, android, admob, gamedev]
keySections: [The check that stops nothing, What adding the SDK costs]
devto: true
linkedin: true
linkedinText:
  - The AdMob Unity plugin has a build check that refuses to continue if your App ID is empty. I left the field empty on purpose to see the error. I got a 19.6 MB APK instead.
  - It installs. It launches. It dies before Unity renders one frame, on a ContentProvider that Google's own SDK merged into the manifest. The build said "Succeeded" and exited 0 the whole time.
  - The reason is one line in Unity's own source — it catches exceptions thrown by build pre-processors, logs them, and carries on. Any plugin that tries to stop your build this way cannot. Full write-up with the manifest dumps, the crash trace and the size numbers.
draft: false
---

I imported the AdMob Unity SDK into an empty Unity 6000.4.0f1 project, built a release APK,
and then left the one field the plugin says it cannot build without empty — to see what the
error looked like.

There was no error. There was a 19,627,503-byte APK that installs, launches, and dies before
Unity draws a single frame.

Everything below came off this laptop: an M3 Max on macOS 26.5.1, Unity 6000.4.0f1 Personal
with the Android module, and `GoogleMobileAds-v11.5.0.unitypackage`, published four days
before I ran this.

However you phrased the search that brought you here — `admob unity integration`,
`admob unity tutorial`, `admob unity guide`, `how to integrate admob in unity`, or
`admob unity github` when you wanted the source instead of somebody's screenshots — the steps
are further down, under [Getting it to work](#getting-it-to-work). The reason they are not at
the top is that the interesting part of this run was the failure the plugin promises to give
you and does not.

## What version 11.5.0 actually pulls in

Before building anything, it is worth reading what the package declares, because the numbers
people quote in forum threads are usually two years old. `GoogleMobileAdsDependencies.xml`, on
Android:

```xml
<androidPackage spec="com.google.android.gms:play-services-ads:25.4.0">
<androidPackage spec="androidx.constraintlayout:constraintlayout:2.1.4">
<androidPackage spec="androidx.lifecycle:lifecycle-process:2.6.2">
<androidPackage spec="androidx.fragment:fragment:1.7.1">
```

And `GoogleUmpDependencies.xml` adds `com.google.android.ump:user-messaging-platform:4.0.0`.
The bundled External Dependency Manager is 1.2.188. There is a second, newer ads library the
plugin knows about and does not use by default —
`com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk:1.4.0`, which the source calls
NextGen and which raises the minimum API level from 23 to 24.

Importing the package headless is the first thing that bit me. This does nothing at all:

```csharp
AssetDatabase.ImportPackage(pkg, false);   // returns immediately, imports nothing
```

It logged my "done" line, exited 0, and left `Assets/` exactly as it was. `ImportPackage` is
asynchronous and `-quit` tears the editor down before it runs. The command-line argument is
synchronous and works:

```bash
Unity -batchmode -quit -projectPath "$P" \
      -importPackage GoogleMobileAds-v11.5.0.unitypackage
```

## The check that stops nothing

`AndroidBuildPreProcessor.cs` opens with a class comment listing what it does. Second item:

> Throw an exception if the Android Google Mobile Ads app ID is not set.

No such check exists in that class. It lives in a different file, `ManifestProcessor.cs`:

```csharp
string appId = instance.GoogleMobileAdsAndroidAppId.Trim();
if (appId.Length == 0) {
  StopBuildWithMessage(
    "Android Google Mobile Ads app ID is empty. Please enter a valid app ID to run ads properly.");
}
```

The two classes have different `callbackOrder` values — `-1` for the Gradle pre-processor,
`0` for the manifest one. So the ordering is: resolve every Android dependency, download
`play-services-ads`, write the Gradle templates, and *then* look at the text box.

I expected that to waste two minutes and fail. Here is what the build report said instead:

```
LAB_RESULT result=Succeeded seconds=151.1 totalSize=135445990 errors=1 warnings=0
LAB_MSG [Preprocess Player] Exception: BuildMethodException: [GoogleMobileAds]
  Android Google Mobile Ads app ID is empty. Please enter a valid app ID to run ads properly.
```

`result=Succeeded` with `errors=1`. The process exited 0. The APK was on disk.

The reason is in Unity's own stack trace, and it is not the plugin's fault:

```
UnityEditor.Build.BuildPipelineInterfaces:InvokeCallbackInterfacesPair (…)
  (at Editor/Mono/BuildPipeline/BuildPipelineInterfaces.cs:492)
UnityEngine.Debug:LogException(Exception)
  (at Editor/Mono/BuildPipeline/BuildPipelineInterfaces.cs:505)
```

Line 505 logs the exception. Line 492 keeps going. Unity catches whatever an
`IPreprocessBuildWithReport` throws, writes it to the console, and continues the build. A
plugin cannot stop your build by throwing, however loudly it says it will.

## What ended up in the APK

The plugin never got to write the App ID, so I checked what the artifact actually contained
with `aapt2` — the tool in your Android SDK, reading the built file, not the project.

```bash
aapt2 dump xmltree noappid.apk --file AndroidManifest.xml \
  | grep -c "com.google.android.gms.ads.APPLICATION_ID"
0
```

Zero. But everything else the SDK merges was there:

```
com.google.android.gms.ads.MobileAdsInitProvider
com.google.android.gms.ads.AdActivity
com.google.android.gms.ads.AdService
com.google.android.gms.ads.OutOfContextTestingActivity
com.google.android.gms.ads.flag.OPTIMIZE_INITIALIZATION
com.google.android.gms.ads.flag.OPTIMIZE_AD_LOADING
```

Two dex files, 8,385,264 and 7,960,200 bytes, carrying 1,002 references to
`com/google/android/gms/ads` between them. So the APK ships an ad SDK that boots itself
through a `ContentProvider`, and no App ID for it to boot with.

## What that does on a real device

I installed it on a Pixel 9 Pro emulator, Android 16, API 36, Play Store system image.

```
E/AndroidRuntime: FATAL EXCEPTION: main
Process: com.indiecore.admoblab, PID: 3041
java.lang.RuntimeException: Unable to get provider
  com.google.android.gms.ads.MobileAdsInitProvider:
  java.lang.IllegalStateException:

******************************************************************************
* Missing application ID. AdMob publishers should follow the instructions    *
* here: https://goo.gle/admob-android-update-manifest.                       *
* to add a valid App ID inside the AndroidManifest.                          *
******************************************************************************

  at android.app.ActivityThread.installProvider(ActivityThread.java:8647)
  at android.app.ActivityThread.installContentProviders(ActivityThread.java:8157)
  at android.app.ActivityThread.handleBindApplication(ActivityThread.java:7814)
Caused by: java.lang.IllegalStateException:
  at com.google.android.gms.ads.internal.client.zzev.attachInfo(
     com.google.android.gms:play-services-ads-api@@25.4.0:21)
```

It dies in `handleBindApplication`. That is a `ContentProvider` installed before
`Application.onCreate`, which is before Unity exists — so nothing of yours runs, no splash
screen appears, and no Unity log line is written. If you have ever seen a Unity game that
force-closes instantly on launch with nothing in the player log, this shape of failure is
worth checking first.

Note the version in the trace: `play-services-ads-api@@25.4.0`, matching the dependency file
exactly. The resolver did its whole job. Only the text box was missing.

## Getting it to work

The fix is the App ID, and Google publishes a sample one so you never have to put a real unit
in a test build:

```csharp
const string TestAppId  = "ca-app-pub-3940256099942544~3347511713";
const string TestBanner = "ca-app-pub-3940256099942544/6300978111";
```

`GoogleMobileAdsSettings.LoadInstance()` is `internal`, so from your own editor code the way
in is the asset:

```csharp
var settings = AssetDatabase.LoadAssetAtPath<ScriptableObject>(
    "Assets/GoogleMobileAds/Resources/GoogleMobileAdsSettings.asset");
var so = new SerializedObject(settings);
so.FindProperty("adMobAndroidAppId").stringValue = TestAppId;
so.ApplyModifiedPropertiesWithoutUndo();
AssetDatabase.SaveAssets();
```

That build came out clean — `errors=0`, and `aapt2` now shows
`APPLICATION_ID = ca-app-pub-3940256099942544~3347511713` in the manifest. It launched, and a
banner loaded:

<img src="/assets/blog/admob-test-banner.jpg" alt="A 320x50 AdMob test banner at the bottom of an Android emulator screen, reading Test Ad, Nice job! This is a 320x50 test ad." width="1200" height="216" loading="lazy" decoding="async">

One more thing had to be fixed on the way, and it is quiet enough to miss:

```
Assembly 'Assets/GoogleMobileAds/GoogleMobileAds.Unity.dll' will not be loaded due to errors:
Unable to resolve reference 'UnityEngine.UI'.
```

My project had `com.unity.modules.ui` but not `com.unity.ugui`, so the assembly providing
`UnityEngine.UI` did not exist. The plugin's Unity-side DLLs need it. That is a warning, the
build succeeds without them, and you find out later. Adding `"com.unity.ugui": "2.0.0"` to
`Packages/manifest.json` cleared it. A project made from a Hub template already has it; mine
was made with `-createProject`, which does not add it.

## What adding the SDK costs

Same project, same settings, one variable:

| Build | APK bytes | Gradle-stage time |
| --- | --- | --- |
| No AdMob | 14,316,448 | 143.9 s |
| AdMob, valid App ID | 19,640,015 | — |

That is **+5,323,567 bytes, or 5.08 MiB — a 37% increase** on an otherwise empty game. For a
small puzzle game that is a real number, and it arrives before you have shown a single ad.

Two toolchain facts worth writing down, because both contradict what the machine looks like
from the outside. Unity used its own bundled JDK, Temurin 17.0.9, not the OpenJDK 25.0.2 that
`java -version` reports here; and its own copy of the Android SDK under `PlaybackEngines`, not
`~/Library/Android/sdk`. Gradle 8.13, Android Gradle Plugin 8.10.0.

## Two smaller things

I set `PlayerSettings.Android.minSdkVersion = AndroidApiLevel23`, which is what AdMob's
documentation asks for. Unity logged an error and overruled me:

```
Minimum supported Android API level is 25 (Android 7.1 Nougat).
Please use AndroidApiLevel25 or higher.
```

Two lines later, AdMob's pre-processor logged `Verified Minimum API Level is >= 23.` It still
carries `const int StandardMinimumAPILevel = 23;` and is checking against a floor Unity 6 has
already moved. Nothing breaks, but AdMob's documented minimum of 23 is not reachable here;
the shipped APK reports `minSdkVersion:'25'`.

The second thing is the one I would have searched `admob unity mediation` over, and it
surprised me. With no mediation adapters installed at all, the initialization callback listed
three:

```
adapter com.google.android.gms.ads.MobileAds = Ready
adapter com.google.ads.mediation.vungle.VungleMediationAdapter = NotReady
adapter com.google.ads.mediation.applovin.AppLovinMediationAdapter = NotReady
adapter com.google.ads.mediation.adcolony.AdColonyMediationAdapter = NotReady
```

`play-services-ads` 25.4.0 enumerates adapters it knows about and reports on ones that are
absent. Three `NotReady` lines in your log are not evidence that a mediation setup is broken.

## The null result I nearly published

For a while I had a good story: the banner code ran on one build and produced no log output on
another, and I could have written that up as a stripping bug.

It was not one. I checked the scene first — the built `level0` was 1,820 bytes without my
component and 2,160 with it, so the object shipped. Then the binary: `AdLoader` and my log
strings were both present in `global-metadata.dat` in every APK, so IL2CPP had stripped
nothing. Then I reinstalled the identical APK on a freshly booted emulator, and it logged
normally.

Same binary, different result, so the variable was the device. On a cold emulator, AdMob's
first initialization is slow:

```
t+0s    calling MobileAds.Initialize
t+45s   initialize callback fired
t+85s   banner LOADED
```

I had been sampling logcat for 25 seconds. The null result was impatience, and the honest
version of this article says so rather than shipping a plausible cause I never tested.

## Takeaway

Read the guard rather than trusting it. A build check written as a thrown exception in an
`IPreprocessBuildWithReport` cannot stop a Unity build, so treat those messages as warnings no
matter how they are phrased. Then check the artifact: `aapt2 dump xmltree your.apk --file
AndroidManifest.xml` takes a second and tells you what you actually built, which is the only
thing your players will run.
