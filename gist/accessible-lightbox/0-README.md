# An image lightbox that behaves for keyboard users

No dependencies. Attaches to any container marked `data-lightbox` containing `.shot`
buttons, builds the dialog once, and gets the keyboard contract right.

```html
<div data-lightbox>
  <button class="shot" data-i="0"><span class="scr"><img src="…" data-full="…"></span></button>
</div>
```

## The bug this exists because of

The obvious way to hide an overlay does not hide it:

```css
.lb      { opacity: 0; pointer-events: none }
.lb.open { opacity: 1; pointer-events: auto }
```

That covers the mouse and nothing else. The element keeps its layout box, stays in the
accessibility tree, and its buttons stay in the tab order — so a keyboard user tabs into
Previous, Next and Close on a dialog that is not on screen. `visibility: hidden` is what
actually removes it.

## Then the part that catches you

`focus()` on a `visibility: hidden` element does nothing. No error, no warning, and
`document.activeElement` is unchanged. So this looks correct and is not:

```js
lb.classList.add('open');
lb.querySelector('.lb-close').focus();   // dropped, if .open has not applied yet
```

With `transition: opacity .3s, visibility .3s` the computed value stays `hidden` until the
transition starts on the next frame. Forcing a reflow does not help. Give visibility a zero
duration and delay it only on the way out:

```css
.lb      { visibility: hidden;  transition: opacity .3s, visibility 0s .3s }
.lb.open { visibility: visible; transition: opacity .3s, visibility 0s 0s }
```

Now it flips in the same tick, the focus lands, and the fade still finishes before the dialog
disappears.

## What the JS handles

- `role="dialog"`, `aria-modal`, and a label — `aria-modal` tells assistive technology to
  ignore the page behind, but does **not** stop Tab walking into it, so the trap is still
  yours to write
- Focus moves to Close on open and returns to the thumbnail that opened it on close
- Tab and Shift+Tab cycle within the dialog
- Escape closes; arrow keys move between images
- `data-full` so the dialog can open a WebP rather than the `<img>` `src`, which is the
  fallback JPEG and roughly three times the size

## Test it by pressing the keys

Reading the code will not find either bug above, because the code says the right thing both
times. Dispatch real `Tab` and `Escape` events and print `document.activeElement` after each.
The contract is visible as output: focus enters, cycles without escaping, returns to the
opener.

---

Written up in full here: **https://www.indiecore.net/blog/opacity-zero-is-not-hidden/**

_Generated from the live scripts — see the post for context._
