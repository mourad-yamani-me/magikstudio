---
title: opacity 0 does not hide anything
date: 2026-09-01
description: My lightbox was invisible and still in the tab order. Fixing that broke focus handling silently, because focus() on a hidden element reports nothing.
tags: [accessibility, css, javascript, web]
code: https://gist.github.com/IndieCoreDev/94c7819fac39ad0f3b181aa84013a414
codeLabel: The lightbox, dependency-free
draft: false
---

Lighthouse has a list of accessibility items it will not judge for you. *Interactive controls
are keyboard focusable. The page has a logical tab order. Offscreen content is hidden from
assistive technology.* No score, no pass, no fail — a list of things a machine cannot decide.

I had been treating that list as decoration. Then I actually worked it, one item at a time,
by driving the running page rather than reading my own markup, and three of the eleven turned
out to be real.

All three were the same component.

## Invisible is not gone

My screenshot lightbox is built by JavaScript on page load and hidden until someone clicks a
thumbnail. Hidden like this:

```css
.lb { position: fixed; inset: 0; display: flex;
      opacity: 0; pointer-events: none; transition: opacity .3s }
.lb.open { opacity: 1; pointer-events: auto }
```

That is a normal way to write a fade. `opacity: 0` makes it invisible. `pointer-events: none`
makes it unclickable. Between them they cover mouse users completely.

They do nothing at all for the keyboard. The element still has layout, still sits in the
accessibility tree, and its three buttons are still tabbable. I counted them in the console:

```js
lbButtonsTabbable: [ 'Previous screenshot', 'Next screenshot', 'Close' ]
totalTabbable: 52
```

On every game page, a keyboard user tabbing through the footer would land on three controls
that were not on the screen. Press Enter on one and a dialog they cannot see starts
responding.

`visibility: hidden` fixes it, because visibility is inherited by hit-testing, focus and
assistive technology in a way opacity is not. Tab stops went from 52 to 49.

## Then I broke the thing that was working

Here is the part I did not see coming. Opening the dialog does this:

```js
lb.classList.add('open');
document.body.style.overflow = 'hidden';
lb.querySelector('.lb-close').focus();
```

That worked before my change. After it, focus stayed on the thumbnail and the dialog opened
behind the user — the exact failure the *managed focus* item on that list describes, newly
introduced by fixing a different item on the same list.

`focus()` on an element that is `visibility: hidden` does nothing. It does not throw. It does
not warn. It returns, and `document.activeElement` is whatever it was before.

And at the moment `.focus()` runs, the element still is hidden, because I had put visibility
in the transition:

```css
transition: opacity .3s, visibility .3s;
```

With a duration on it, the computed value does not flip until the transition starts on the
next frame. The class is applied, the style says `.open`, and `getComputedStyle` still reports
`hidden` for one more tick. I confirmed that by reading it twice — immediately after the
click, and 600 ms later:

```
same tick:   { hasOpenClass: true, visibility: 'hidden',  opacity: '0' }
after 600ms: { hasOpenClass: true, visibility: 'visible', opacity: '1' }
```

I tried forcing a reflow with `void lb.offsetWidth` first. That did not help, which is the
clue that it was never a style-flush problem. The fix is to take visibility out of the timed
part and delay it only on the way out:

```css
.lb      { visibility: hidden;  transition: opacity .3s, visibility 0s .3s }
.lb.open { visibility: visible; transition: opacity .3s, visibility 0s 0s }
```

Zero duration, no delay when opening, so it flips in the same tick and `focus()` lands.
Delayed by the length of the fade when closing, so the dialog does not vanish mid-animation.

## Testing it by pressing the keys

I could not have found either bug by reading the code, because both times the code says the
right thing. The class gets added. `.focus()` gets called.

So I drove it over the DevTools protocol instead — real `Tab` and `Escape` key events
dispatched at the page, printing `document.activeElement` after each one:

```
before open, focus: BUTTON[Enlarge screenshot 1 of 5].shot
after open,  focus: BUTTON[Close].lb-close
tabbing forward:    lb-prev → lb-next → lb-close → lb-prev → lb-next → lb-close
shift+tab:          lb-next
after Escape:       BUTTON[Enlarge screenshot 1 of 5].shot
```

That is the whole contract for a modal, visible as output. Focus enters, cycles without
escaping, and returns to whatever opened it. The first run of that same script printed
`BUTTON[Enlarge screenshot 1 of 5]` on the second line, which is how I knew.

The dialog also needed to say what it was. It had no `role`, so a screen reader announced
three buttons with no indication that anything had opened:

```js
lb.setAttribute('role', 'dialog');
lb.setAttribute('aria-modal', 'true');
lb.setAttribute('aria-label', 'Screenshot viewer');
```

`aria-modal` tells assistive technology to ignore the rest of the page. It does not stop Tab
from walking out into it, so the trap is still yours to write.

## The one I would look at first on your site

Any element you hide with opacity and reveal with a class. Carousels, drawers, tooltips,
cookie banners, off-canvas menus. If it contains a link or a button, tab through your page
with your eyes on the screen and see where focus goes when it disappears.

Mine had been shipping like that for months, on six pages, and every automated audit I ran
gave the site 100 for accessibility the entire time.
