# Two Vite plugins for a Capacitor game

> **Full write-up:** [Shipping a 4 MB level pack](https://www.indiecore.net/blog/shipping-a-4mb-level-pack/)

One shrinks a JSON content pack on its way into `dist/`; the other removes an SDK the shipped
app can never execute.

## Files

One file. It minifies a JSON content pack on its way into `dist/`, leaving the repo copies
pretty-printed and diffable: 4.37 MB -> 2.36 MB, 45% of it whitespace nothing reads at runtime.

## The two bugs these encode

**`closeBundle` also fires when the build failed.** A cleanup hook there throws its own ENOENT
about a `dist/` that was never created, and replaces the real error with it. `writeBundle` runs
only on a successful write — and Vite copies `publicDir` into `outDir` *before* the write phase,
so the files are already there. (Get `outDir` from `configResolved`, too: Vite may load a config
from a temp file, so `import.meta.dirname` can point into `node_modules/.vite-temp/`.)

**Capacitor plugins ship a browser fallback you cannot tree-shake.** Every
`@capacitor-firebase/*` plugin registers `web: () => import('./web')`. `registerPlugin` only calls
it on a browser, but it is a static import site, so the bundler emits it — and each of those
`web.js` files drags in its slice of the Firebase JS SDK. That, not app code, is where a 525 KB
Firestore chunk and a 168 KB Auth chunk come from.

## The part to copy even if you copy nothing else

`generateBundle` scans the emitted chunks and **fails the build** if the SDK reappears. A stub
only helps while nothing re-imports the real thing; without the assertion the next dependency
upgrade quietly puts 700 KB back and nobody finds out.

---

Written up in full here: **[Shipping a 4 MB level pack](https://www.indiecore.net/blog/shipping-a-4mb-level-pack/)**

_A distilled snippet from a shipped engine — see the post for context._
