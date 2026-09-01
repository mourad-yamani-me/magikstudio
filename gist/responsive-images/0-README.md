# Responsive images that satisfy Chrome's actual budget

> **Full write-up:** [Lighthouse's image budget is w × h ÷ 6](https://www.indiecore.net/blog/lighthouse-image-budget/)

Two pieces of a static site generator. One encodes every derivative and holds it under the
byte budget Lighthouse measures against; the other writes the `<picture>` markup that
decides which of them a browser downloads.

```
source.jpg ──► 200w / 320w / … WebP ──► <picture> with a sizes string
                    │
                    └─ each one under w × h ÷ 6 bytes
```

## The constant

Lighthouse's *Improve image delivery* insight reports both a file's size and the bytes it
considers wasted on compression. Subtract one from the other and the target it has in mind is
**one sixth of a byte per pixel**, every time — a 256×256 icon: 65536 ÷ (18804 − 7881) =
6.0000. Savings under 4 KiB are not reported, which is why some files sit over the line and
stay quiet.

`ceiling()` computes it. `encodeWebp()` re-encodes with `cwebp -size` only when a file
overshoots.

**Treat it as a ceiling, never a target.** Most images land far under it — one 400px
screenshot here is 21 KB against a 47 KB ceiling — and encoding everything *to* the budget
would double them.

## Files

| File | What it does |
| --- | --- |
| `image-pipeline.mjs` | Encodes the derivatives, content-addressed so nothing re-encodes twice |
| `responsive-markup.mjs` | Rewrites `<img>` into `<picture>` with srcset, sizes and dimensions |

## Worth knowing

- **The cache key includes the encoder flags.** Change quality or method and every key
  changes, so old output is never replayed as though it had been made with the new settings.
  Without that, a warm cache silently serves you the previous encoder's work.
- **`sizes` is a claim about layout, and it is easy to get wrong.** Every value in the markup
  file was measured against the rendered page, not estimated. One string covering two
  different layouts is right for neither: the same screenshot renders at a constant 254px in a
  carousel and at 116px in a five-across grid on a tablet.
- **One attribute per layout.** A marker that means two things — a hero on one template and a
  carousel on another — will size one of them for the other's box.
- **Method 6 with `-sharp_yuv` is smaller *and* sharper** than the default at a lower quality
  number. It is slow, which is what the cache is for.
- **The second half of the insight is geometry, not compression.** Its waste figure is
  `bytes × (1 − displayedPx ÷ intrinsicPx)`, which reaches zero only when the file has as
  many pixels as the CSS box. That is a 1× image, and it will look soft on any modern phone.

---

Written up in full here: **[Lighthouse's image budget is w × h ÷ 6](https://www.indiecore.net/blog/lighthouse-image-budget/)**

_Generated from the live generator — see the post for context._
