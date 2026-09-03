---
title: Gradle build failed is not the error
date: 2026-09-03
description: Unity prints CommandInvokationFailure, then 67 environment variables. The line saying what broke is 235 lines up. Four failures I reproduced in Unity 6000.4.
tags: [unity, android, gradle, gamedev]
keySections: [Where the cause actually is, Four builds I broke on purpose]
devto: true
linkedin: true
linkedinText:
  - Unity tells you "CommandInvokationFailure: Gradle build failed." and then prints 67 environment variables. Not one of them is the reason. In my log the line that actually said what broke was at 923, and the message everyone searches for was 235 lines below it, at 1158.
  - So I made a throwaway Unity 6000.4 project and broke it four ways on purpose — one jar included twice, a repository declared in the wrong file, a mainTemplate gradle file left over from an older Unity, and one I could not break at all. Every log in the write-up came off this laptop, not off a forum thread.
  - The short version: search the console for "* What went wrong:". Whatever follows it is the thing to look up, and it has an answer. "Gradle build failed" is a category, the way "the car won't start" is a category.
draft: false
---

I made a throwaway Unity 6000.4.0f1 project on a Mac, built a release APK from it, and then
broke it four different ways to see what the console would say. The APK took 155 seconds in
the Gradle stage and came out at 27 MB. Every failure below is from a log on this laptop, not
from a thread I read.

The reason for doing it that way: the message everybody searches for says nothing about the
project that produced it, and I wanted to know exactly where the part that does say something
had gone.

## The error you searched for

However you phrased it — `unity gradle build failed`, `unity error gradle build failed`,
`unity commandinvokationfailure gradle build failed`, `unity android build failed gradle`,
`unity 6 gradle build failed`, `unity 2022 gradle build failed`,
`unity firebase gradle build failed` — you got here from the same eleven words in the console:

```
CommandInvokationFailure: Gradle build failed. 
/Applications/Unity/Hub/Editor/6000.4.0f1/PlaybackEngines/AndroidPlayer/OpenJDK/bin/java -classpath "/Applications/Unity/Hub/Editor/6000.4.0f1/PlaybackEngines/AndroidPlayer/Tools/gradle/lib/gradle-launcher-8.13.jar" org.gradle.launcher.GradleMain "-Dorg.gradle.jvmargs=-Xmx4096m" "assembleRelease" 

Environment Variables:
XPC_FLAGS = 0x0
CLAUDE_CODE_ENTRYPOINT = claude-vscode
ANDROID_NDK_ROOT = /Applications/Unity/.../AndroidPlayer/NDK
LANG = C.UTF-8
```

Sixty-seven of those variables in my log, and I counted them because I kept scrolling through
them looking for the reason. There isn't one in there. Unity started a Java process, the
process exited 1, and this block is Unity reporting *which* process it started. It would look
identical if the failure were a missing semicolon or a full disk.

Which is why the answers on the first page of results are all different from each other, and
why none of them worked for you. They are answers to different questions that produce the same
sentence.

## Where the cause actually is

Here is the shape of the whole log for one failing build of an otherwise empty project — 1,572
lines, from a project with one scene and no gameplay in it:

| Line | What is there |
| --: | --- |
| 171 | `CommandInvokationFailure: Unable to list connected devices` — unrelated, no phone plugged in |
| 174 | environment variables, first dump |
| 921 | `FAILURE: Build failed with an exception.` |
| **923** | **`* What went wrong:` — the cause** |
| 926–1336 | 410 lines listing every duplicate class |
| 1140 | `BUILD FAILED in 6s` |
| 1158 | `CommandInvokationFailure: Gradle build failed.` |
| 1161 | environment variables, second dump, 67 of them |
| 1231 | the whole thing again, quoted inside the exception |

The line that tells you what to fix comes **235 lines before** the line that tells you
something failed. Everyone scrolls down from the error. The answer is up.

Two other things that log shows. There is a `CommandInvokationFailure` at line 171 that has
nothing to do with the build — it is ADB failing to list devices, with its own full
environment dump, and in a headless build it is always there. And the real Gradle output is
printed twice: once as it happens, once again quoted inside the exception body at line 1231,
which is why the log looks twice as bad as the problem is.

So stop reading the console and grep the log:

```bash
grep -A6 '^\* What went wrong:' ~/Library/Logs/Unity/Editor.log
```

That worked on every failure I produced. The Editor log is at
`~/Library/Logs/Unity/Editor.log` on macOS, `%LOCALAPPDATA%\Unity\Editor\Editor.log` on
Windows, `~/.config/unity3d/Editor.log` on Linux.

Unity also saves the Gradle run on its own, which is cleaner to read and easier to link to a
colleague:

```
Library/Bee/Android/Prj/<Mono2x|IL2CPP>/Gradle/launcher/build/outputs/logs/unity-assembleRelease-build.log
```

## Four builds I broke on purpose

### One jar, twice

I copied `unity-classes.jar` out of the generated Gradle project into
`Assets/Plugins/Android/` under a second name, which is structurally what happens when two
plugins each vendor the same library.

```
* What went wrong:
Execution failed for task ':launcher:checkReleaseDuplicateClasses'.
> A failure occurred while executing com.android.build.gradle.internal.tasks.CheckDuplicatesRunnable
   > Duplicate class com.unity3d.player.UnityPlayer found in modules unity-classes-copy.jar
     -> jetified-unity-classes-copy (unity-classes-copy.jar) and unity-classes.jar -> ...
```

410 lines of that, one per class. The task name is the useful part:
`checkReleaseDuplicateClasses` means two artifacts on the classpath contain the same class,
and the two module names on the first line are the two to reconcile. In a real project the
pair is usually AdMob and In-App Purchase pulling different versions of Play Billing or
`play-services-basement` through the External Dependency Manager, and the first thing to try
is *Assets → External Dependency Manager → Android Resolver → Delete Resolved Libraries*,
then a force resolve.

### A repository in the wrong file

This one is specific to Unity 2022.2 and later, and it is worth knowing because the
instructions shipped with a lot of ad and analytics SDKs are older than the change.

I added a JitPack-only dependency to `Assets/Plugins/Android/mainTemplate.gradle` and, in the
same file, the repository it lives in:

```gradle
dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
**DEPS**    implementation 'com.github.PhilJay:MPAndroidChart:v3.1.0'
}

repositories {
    maven { url 'https://jitpack.io' }
}
```

```
* What went wrong:
Execution failed for task ':launcher:checkReleaseDuplicateClasses'.
> Could not resolve all files for configuration ':launcher:releaseRuntimeClasspath'.
   > Could not find com.github.PhilJay:MPAndroidChart:v3.1.0.
     Searched in the following locations:
       - https://dl.google.com/dl/android/maven2/com/github/PhilJay/...
       - https://repo.maven.apache.org/maven2/com/github/PhilJay/...
```

JitPack is not in that list. The repository block was read, parsed, and ignored, because
Unity's generated `settings.gradle` sets:

```gradle
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
```

Under `PREFER_SETTINGS`, Gradle discards repositories declared anywhere else. No warning
appears — the only symptom is a search list that quietly lacks the one place the artifact
exists.

The fix is the same declaration, moved. Copy `settingsTemplate.gradle` next to
`mainTemplate.gradle` and put the repository in *its* `dependencyResolutionManagement` block:

```gradle
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        **ARTIFACTORYREPOSITORY**
        maven { url 'https://jitpack.io' }
        google()
        mavenCentral()
```

Same dependency, same project, next build succeeded. If a plugin's README tells you to edit
`mainTemplate.gradle` and the artifact still cannot be found, the README predates this.

### A mainTemplate.gradle from an older Unity

I dropped in the template Unity 2019 and 2020 generated — the one with
`minSdkVersion **MINSDKVERSION**`, `lintOptions` and `aaptOptions` — which is exactly what a
project carries when it has been upgraded and the file was committed years ago.

Gradle never ran. Unity 6 stopped at the prerequisites step:

```
Assets/Plugins/Android/mainTemplate.gradle file is missing the CMake arguments required
for GameActivity and Framepacing to work. To fix this, add "**DEFAULT_CONFIG_SETUP**"
inside the defaultConfig block. If not fixed, your build can fail.

UnityException: Error
mainTemplate.gradle file is using the old androidResources noCompress property definition
which does not include types defined by unityStreamingAssets constant.
```

That is a genuine improvement, and it changes the advice. The Unity 6 token names differ from
the old ones — `**MINSDK**` rather than `**MINSDKVERSION**`, `compileSdk` rather than
`compileSdkVersion`, `lint` rather than `lintOptions` — so if you have a custom template, the
reliable move after an editor upgrade is to copy the current one out of

```
<editor>/PlaybackEngines/AndroidPlayer/Tools/GradleTemplates/mainTemplate.gradle
```

and reapply your handful of edits to it, rather than patching the old file forward.

### The one that refused to break

I tried to reproduce the most-cited conflict of the past two years — the app declaring a
lower minimum SDK than a library it depends on — by setting the project to API 22 and adding
`com.google.android.gms:play-services-ads:24.3.0`, which needs 23. The build failed, but not
where I expected:

```
Assets/Editor/BuildAndroid.cs(26,48): error CS0619: 'AndroidSdkVersions.AndroidApiLevel22'
is obsolete: 'Minimum supported Android API level is 25 (Android 7.1 Nougat).
Please use AndroidApiLevel25 or higher.'
```

Unity 6000.4 will not compile a script that names API 22. The floor is 25, above every
current Play Services minimum, so the classic
`uses-sdk:minSdkVersion 22 cannot be smaller than version 23 declared in library` is no longer
reachable from a modern editor — it is still the top answer on threads dated July 2025, and
still the right answer if you are on 2021 or 2022 LTS. With the floor left alone, that same
AdMob dependency resolved and built with no changes at all.

A second one that would not break: putting `<uses-sdk android:minSdkVersion="34" />` in the
manifest of an `.androidlib` under `Assets/Plugins/Android/`. Unity regenerates that module's
`build.gradle` with the player's minimum, so the manifest declaration is overridden and the
build succeeds. Library minimums bite when they arrive as an AAR from a repository, not when
they are sitting in your own project.

## Two pieces of stale advice

Both come from a time when Unity used your machine's tooling. It does not.

The prerequisites step prints what it is actually going to use, and mine looked like this:

```
 JDK: '/Applications/Unity/Hub/Editor/6000.4.0f1/PlaybackEngines/AndroidPlayer/OpenJDK'
 Android SDK: '/Applications/Unity/Hub/Editor/6000.4.0f1/PlaybackEngines/AndroidPlayer/SDK'
 Android NDK: '/Applications/Unity/Hub/Editor/6000.4.0f1/PlaybackEngines/AndroidPlayer/NDK'
 Gradle: '.../AndroidPlayer/Tools/gradle' (Gradle Version: '8.13' Android Plugin Version: '8.10.0')
```

**Installing a JDK will not help.** Unity ran its own bundled OpenJDK 17.0.9. The system Java
on this laptop is 25 and was never invoked. **Pointing Unity at your Android SDK will not
help either** — `ANDROID_HOME` was set to `~/Library/Android/sdk` in the environment dump
Unity printed, and Unity used its own SDK anyway. Both answers were correct in 2019. They now
send people to change something that has no effect, then conclude their install is corrupt.

## What is actually breaking builds this year

The failures I could not stage on an empty project, from reports with dates on them:

- **Gradle running out of heap**, which surfaces as something else entirely. One November 2025
  report on Unity 6000.0.58f2 shows it as
  `Execution failed for task ':launcher:signReleaseBundle'` and
  `java.lang.IllegalArgumentException: Self-suppression not permitted`, fixed by raising
  Maximum JVM Heap Size from 4096 to 8192 in *Preferences → External Tools*. If your
  `unity android build error` mentions bundling or signing and the project is large, try this
  before anything else.
- **16 KB page alignment.** From 31 May 2026 Play stops accepting updates whose native
  libraries are 4 KB-aligned. NDK r27 and later emit aligned segments by default; the fix is
  an editor and NDK upgrade, not a Gradle setting.
- **Non-ASCII characters or spaces in the project path**, still, still on Windows.
- **Two plugins, one library.** The duplicate-class case above, arriving through the External
  Dependency Manager rather than by hand.

## The takeaway

`CommandInvokationFailure: Gradle build failed.` is a category, in the way that "the car won't
start" is a category. Reading the console top to bottom is how you end up believing it is
about environment variables, and reinstalling the editor over a two-line Gradle problem.

Grep for `* What went wrong:`. Whatever it says next — a task name, a class name, a coordinate
that could not be found — that is the thing to search, and it has an answer.

