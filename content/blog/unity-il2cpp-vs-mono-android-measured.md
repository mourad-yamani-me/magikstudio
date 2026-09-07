---
title: Unity IL2CPP vs Mono on Android, measured
date: 2026-09-09
description: Same project, both scripting backends, Unity 6. IL2CPP came out 47% smaller and took twice as long to build — and the Mono APK would not install on the test device at all.
tags: [unity, android, il2cpp, gamedev]
keySections: [The numbers, Mono cannot target ARM64]
devto: true
linkedin: false
---

The advice you find on `unity il2cpp vs mono` is mostly repeated from 2019: IL2CPP is faster at
runtime, slower to build, and makes a bigger APK. I built the same project both ways on Unity
6000.4.0f1 to see which parts still hold. One of them is backwards, and the interesting result
is not a number at all.

The project is deliberately small — one scene, one `MonoBehaviour` doing two million
iterations of `Math.Sqrt(i) / i` so there is some managed work to compile. Android, release,
built from `-batchmode` on an M3 Max.

## The numbers

| | Mono2x | IL2CPP |
| --- | --- | --- |
| Build, as reported by `BuildReport` | 108.9 s | 230.4 s |
| APK | 27,301,649 bytes | 14,323,788 bytes |
| ABI produced | `armeabi-v7a` | `arm64-v8a` |
| `.dll` files inside the APK | 101 | 1 |

**IL2CPP produced an APK 12,977,861 bytes smaller — 47.5% less** — and took 2.1× as long to
build. The build-time half of the folklore is right. The size half is backwards, at least at
this project size and on this Unity version.

The native libraries say where it goes:

```
Mono, armeabi-v7a                 IL2CPP, arm64-v8a
  libunity.so        20,768,248     libunity.so       13,926,400
  libmonobdwgc-2.0.so 6,013,288     libil2cpp.so       9,651,328
  libmono-native.so   1,169,684     libc++_shared.so   1,292,904
  libMonoPosixHelper.so 350,080     + global-metadata.dat 1,555,108
```

Mono ships a 6 MB runtime to interpret your code, and a much larger `libunity.so`. IL2CPP
ships your code compiled into `libil2cpp.so` instead. In a bigger game `libil2cpp.so` grows
with your codebase while Mono's runtime stays fixed, so the gap narrows — do not read 47% as a
constant.

The `.dll` count is the line I would put in front of anyone who has not thought about it. A
Mono APK carries 101 real .NET assemblies, including yours. Renaming the file to `.zip` and
opening `Assembly-CSharp.dll` in any decompiler gives back readable C#. The IL2CPP build has
one. That is not obfuscation and IL2CPP is not a security feature, but the difference between
"unzip it" and "reverse a native binary" is real.

## Mono cannot target ARM64

This is where I was wrong, and where checking mattered.

I assumed Unity would refuse to *set* ARM64 with the Mono backend. It does not:

```csharp
PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.Mono2x);
PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
// reads back as: ARM64
```

No warning, no complaint. The setting sticks. The *build* is where it fails, and the message
is wrong about why:

```
LAB_CFG    backend=Mono2x arch=ARM64
LAB_RESULT result=Failed errors=1
[Prepare For Build] Exception: UnityException: Target architecture not specified
```

The architecture was specified. It is ARM64, and it is printed on the line above. Exit code 1,
no APK. If you search that string you will find people adding architectures to a project that
already had one.

Then the case that actually costs somebody a release. Select **both** ARMv7 and ARM64, which
is what you do when you want a universal build:

```
LAB_CFG    backend=Mono2x arch=ARMv7, ARM64
LAB_RESULT result=Succeeded errors=0
```

Exit code 0. No errors. No warnings. I grepped the entire build log for `arm64`, `64-bit` and
`architecture` and found nothing. The APK it produced contains:

```
lib/armeabi-v7a/
```

That is all. It is byte-for-byte the same size as the ARMv7-only build, 27,301,649 bytes. You
asked for two architectures, you got one, and the build told you it succeeded. Google Play
requires a 64-bit version of every native library, so this is a green build that gets rejected
at upload with nothing in the Unity log to explain it.

## The comparison I could not make

I could not measure which backend is faster at runtime, and the reason is the practical
answer to `unity android il2cpp or mono` in 2026.

```bash
$ adb shell getprop ro.product.cpu.abilist
arm64-v8a

$ adb install -r mono.apk
Failure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries, res=-113]
```

The test device — an Android 16, API 36 emulator image — has no 32-bit support at all. The
Mono build cannot be installed on it. Since Mono cannot produce arm64, there is no
configuration in which a Mono build runs on that device, and every arm64-only Android device
in the field is in the same position.

So I have no `unity android mono vs il2cpp` speed figure to give you. I also will not give you
the IL2CPP numbers I did collect: across four cold launches the same APK measured 570, 1561,
2020 and 2514 ms to first frame, and the managed loop took between 10 and 24 ms. A 4.4× spread
is emulator noise, and quoting the fastest one would be a made-up result. Startup timing needs
real hardware and many more runs than I did.

## What this changes

For an Android game, `unity il2cpp android` is not a performance decision any more. It is the
only backend that produces a binary current devices will install and Google Play will accept.
Mono's remaining use is the editor and fast local iteration, where the shorter build genuinely
helps.

Two things to take away if you touch these settings. Set the architecture *after* the
backend and log what it reads back, because Unity will accept a combination it cannot build.
And check the ABIs in the artifact rather than the project settings:

```bash
unzip -l app.apk | grep -oE "lib/[a-z0-9-]+/" | sort -u
```

One line, and it catches the silent 32-bit-only build before Google Play does.
