---
title: Lighthouse's image budget is w × h ÷ 6
date: 2026-09-01
description: "Improve image delivery" makes two complaints in one panel. Both have exact arithmetic behind them, readable straight out of the JSON report.
tags: [performance, lighthouse, images, web]
code: https://gist.github.com/IndieCoreDev/d653221d437be0389aa4b4281f929e99
codeLabel: The pipeline and the markup, ready to adapt
devto: true
linkedin: false
draft: false
---

Lighthouse told me my home page was carrying 345 KiB of unnecessary image bytes, on a page
already scoring 99. The panel is called *Improve image delivery* and it gives you a list of
files, a savings figure, and one of two sentences under each:

- *Increasing the image compression factor could improve this image's download size.*
- *This image file is larger than it needs to be (400×710) for its displayed dimensions
  (254×452). Use responsive images to reduce the image download size.*

Those look like the same complaint. They are not, they behave differently, and only one of
them can ever reach zero on a site that serves retina screens.

## Reading the constant out of the report

The HTML panel rounds everything. The JSON does not, and it gives you both the file size and
the bytes it considers wasted, which means the target it has in mind is just subtraction.

A 256×256 icon on my site:

```
totalBytes:   18804
wastedBytes:   7881   ("increasing the image compression factor…")
```

So Lighthouse wanted 10,923 bytes. The image has 65,536 pixels. 65536 ÷ 10923 = **6.0000**.

One more, a 400×712 screenshot:

```
totalBytes:   55558
wastedBytes:   8091
target:       47467      →  284800 px ÷ 47467 = 6.0000
```

The compression target is one sixth of a byte per pixel, or 1.333 bits per pixel. Under that
line, no complaint. Over it, a complaint — unless the saving comes to less than 4 KiB, which
is the reporting floor and explains the files that are technically over and stay quiet
anyway.

That is a number you can build against. My encoder now computes `w × h ÷ 6` for every
derivative and re-encodes only the ones that overshoot.

## Treat it as a ceiling, never a target

The obvious move once you have a target is to encode everything to it. That would have
roughly doubled several of my files.

Most images were already far under. One 400px-wide screenshot was 21 KB against a 47 KB
ceiling, because it is a simple picture that compresses well. Encoding it *to* the budget
would have added 26 KB of nothing.

```
if (cap && fs.statSync(dst).size > cap)
  execFileSync('cwebp', ['-size', String(cap), '-m', '6', '-sharp_yuv', '-pass', '8', …]);
```

Only files above the line get touched. The rest keep whatever quality they landed on.

## The second complaint is geometry, and it does not negotiate

The other sentence has its own arithmetic, and it is not about compression at all:

```
waste = bytes × (1 − displayedPixels ÷ intrinsicPixels)
```

I checked that against all eight flagged files on my home page. It reproduces every figure
Lighthouse reported to within 7 bytes.

That tells you exactly when it reaches zero: when the file has the same number of pixels as
the CSS box it lands in. A 254px slot wants a 254px-wide file. That is a 1× image, and on the
phone Lighthouse is emulating — `deviceScaleFactor: 1.75` — a 254px file in a 254px slot is
visibly soft.

So the audit compares intrinsic pixels against CSS pixels while simulating a screen that has
1.75 device pixels per CSS pixel. Satisfying it completely means shipping images that look
worse on the device it is pretending to be.

## What I actually did

Compression: hold everything under `w × h ÷ 6`, using cwebp's method 6 with `-sharp_yuv`,
which reaches the same fidelity in fewer bytes than the default method. Every quality value
was picked by measuring PSNR against what the old encoder produced, so nothing could come out
worse than what it replaced.

Icons are exempt. Their art is lettering and gradients, where WebP shows its seams first.
Holding one to the ceiling cost 2.8 to 3.8 dB and read as blotchy type at 3× magnification,
to save about 1.4 KB. I looked at them side by side before deciding. The same ceiling on a
photographic screenshot cost 0.15 dB and I could not tell the two apart at 250%.

Resolution: I stopped the candidate ladder at 320px for a 254px slot. That is 1.26×, above 1×
and below what the audit calls waste. Rendered at the size it actually appears, it is
indistinguishable from the 400px file it replaced. I compared those too, at the real display
size rather than at full resolution, where a difference exists that no visitor ever sees.

The result on the home page: image waste 345 KiB → 0, the insight passing with nothing
flagged, page total 520 KiB → 353 KiB. On a game page it went 482 KiB → 40 KiB, and the 40
that remain are the geometry complaint on two files I have decided to keep sharp.

## Why bother reverse-engineering it

I could have twiddled the quality number until the warning went away. I have done that
before. What you get is a setting that satisfies today's audit and no idea which direction is
correct, so the next person to touch it — including you, in four months — starts over.

Knowing it is `w × h ÷ 6` turns a warning into a build rule. The other formula told me
something more useful: one of these two complaints was a bug in my markup, and the other is a
disagreement about how sharp images should be. Only one of those was worth fixing.
