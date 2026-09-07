---
title: Unity 6 Android build errors that exit 0
date: 2026-09-07
order: 3
description: Four times last week a headless Unity 6 Android build told me it had succeeded when it had not. Every one returned exit code 0, which is the only thing CI reads.
tags: [unity, android, ci-cd, gradle, gamedev]
keySections: [The build that succeeded with one error, What to check instead of the exit code]
devto: true
linkedin: false
---

A `unity 6 android build error` is easy to deal with when Unity says the words. What cost me
an evening was the opposite: four builds that reported success, returned exit code 0, and had
not done the thing I asked. On a laptop you notice, eventually. In CI, exit code 0 is the
whole signal, and a green pipeline shipped an APK that crashed on launch.

These all came out of one week on Unity 6000.4.0f1, building Android from `-batchmode` on
macOS. Three of the four are Unity behaving as designed.

## The build that succeeded with one error

I was building a project with the Google Mobile Ads plugin and had deliberately left its App
ID blank, expecting the plugin's own check to stop me. The build report:

```
result=Succeeded  seconds=151.1  errors=1  warnings=0
[Preprocess Player] Exception: BuildMethodException: [GoogleMobileAds]
  Android Google Mobile Ads app ID is empty.
```

`Succeeded`, and `errors=1`, at the same time. Exit code 0, APK on disk, and that APK died on
launch because the manifest was missing the value the pre-processor never got to write.

The mechanism is in Unity's own stack trace:

```
UnityEditor.Build.BuildPipelineInterfaces:InvokeCallbackInterfacesPair (…)
  (at Editor/Mono/BuildPipeline/BuildPipelineInterfaces.cs:492)
UnityEngine.Debug:LogException(Exception)
  (at Editor/Mono/BuildPipeline/BuildPipelineInterfaces.cs:505)
```

Unity catches whatever an `IPreprocessBuildWithReport` throws, logs it, and carries on to the
next callback. So **no plugin can stop your build by throwing**, however firmly its
documentation says otherwise. The exception becomes a line in a log nobody reads, and the
build continues without whatever that pre-processor was supposed to do.

I wrote that one up separately, with the crash trace and the manifest dumps, in
[the AdMob post](/blog/admob-unity-sdk-empty-app-id/).

## The import that imported nothing

Importing a `.unitypackage` from an editor method looks like this, and does nothing:

```csharp
AssetDatabase.ImportPackage(pkg, false);
AssetDatabase.Refresh();
Debug.Log("done");     // prints
```

It printed `done`. It exited 0. `Assets/` was untouched — no error, no warning, no partial
import. `ImportPackage` schedules work on the editor's main loop, and `-quit` tears the editor
down before that loop runs again.

The command-line argument is synchronous and does work:

```bash
Unity -batchmode -quit -projectPath "$P" -importPackage thing.unitypackage
```

Anything asynchronous is suspect under `-quit`. If a call returns `void` and its work shows up
in the Project window a moment later when you do it by hand, it will probably no-op in
batchmode.

## The setting that was quietly overruled

```csharp
PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel23;
```

Unity logged this as an error and then ignored me:

```
Minimum supported Android API level is 25 (Android 7.1 Nougat).
Please use AndroidApiLevel25 or higher.
```

The shipped APK reported `minSdkVersion:'25'`. The build still exited 0. A `Debug.LogError`
during a build is not a build failure — it does not increment the report's error count and it
does not change the exit code. Worth knowing before you trust a grep for `error` in a Unity
log, because you will match hundreds of them that mean nothing.

The plugin in that project logged `Verified Minimum API Level is >= 23.` two lines later,
against its own constant. Both were satisfied. Neither was right.

## The one that failed properly

For contrast, here is Unity refusing:

```
LAB_RESULT result=Unknown errors=1
LAB_MSG [Build player] Error: Cannot build untitled scene.
```

Exit code 1, no APK. This is what a real failure looks like — `result` is not `Succeeded`, and
the process returns non-zero. I had passed `scenes = new string[0]` and never saved a scene,
so there was nothing to build. Save one first:

```csharp
var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");
```

The useful part is the contrast. Unity *can* fail your build and return non-zero. It just does
not do it for any of the three cases above.

## What to check instead of the exit code

The build report already knows. Read both fields, not one:

```csharp
var r = BuildPipeline.BuildPlayer(opts);
var s = r.summary;
if (s.result != BuildResult.Succeeded || s.totalErrors > 0)
{
    foreach (var step in r.steps)
        foreach (var m in step.messages)
            if (m.type == LogType.Error || m.type == LogType.Exception)
                Debug.Log($"[{step.name}] {m.type}: {m.content}");
    EditorApplication.Exit(1);
}
```

`totalErrors > 0` is the line that catches the swallowed pre-processor exception, and printing
`report.steps` is what tells you which step produced it — the console alone will not, because
by then it is thousands of lines of Gradle output.

Then check the artifact rather than the log, because a build that lies in its report will also
lie in its log. For an Android build that is one command, using the `aapt2` already in your
Android SDK:

```bash
aapt2 dump xmltree app.apk --file AndroidManifest.xml | grep -c "YOUR_REQUIRED_META_DATA"
aapt2 dump badging app.apk | grep -E "minSdkVersion|targetSdkVersion"
```

That is what caught the missing App ID for me, after the report and the exit code had both
said everything was fine. If a value has to be in the manifest for the app to start, assert on
it in CI. It costs a second and it is the only check that reads what your players will run.

## Takeaway

When a `unity build not working` search sends you looking for the error message, consider that
there may not be one. Unity's exit code covers a narrower set of failures than most people
assume: it catches a build it refused to start, and not much else. A pre-processor that threw,
a setting that was overruled, and an asynchronous call that never ran all look identical to a
passing pipeline.

Read `summary.totalErrors`, print `report.steps`, and inspect the file you built.
