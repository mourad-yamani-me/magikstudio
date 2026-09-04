---
title: Scroll reveals are killing your LCP score
date: 2026-08-26
description: A fade-in-on-scroll effect cost this site 2.1 seconds of Largest Contentful Paint. The fix took one line, and the Lighthouse score went from 69 to 99.
tags: [performance, web, lighthouse]
devto: true
linkedin: false
draft: true
---

Fade-in-on-scroll is the most common effect on the modern web. It's also, if you apply it
carelessly, one of the easiest ways to destroy your Core Web Vitals — and Google uses those
for ranking.

Here's what happened on this site, with real numbers.

## The symptom

Lighthouse, mobile, home page:

```
Performance   69
FCP          3.0 s
LCP          6.5 s
Speed Index  3.5 s
```

Accessibility and SEO were fine. Performance was not, and LCP was the worst of it. The usual
suspects — big images, render-blocking CSS, slow fonts — were all worth fixing, but none of
them explained six and a half seconds.

## Finding the actual cause

Lighthouse breaks LCP into parts. That's the report worth reading:

```
Time to first byte        57 ms
Element render delay   2163 ms
```

Fifty-seven milliseconds to get the HTML. Then **two seconds of nothing.**

And the element it named wasn't an image at all — it was a paragraph of text:

```
section.hero > div.shell > div > p.lede
```

Text. Already in the HTML. Already styled. Sitting there for two seconds without painting.

## The culprit

The scroll-reveal:

```css
.rv {
  opacity: 0;
  transform: translateY(34px);
  transition: opacity .85s cubic-bezier(.2,.7,.2,1),
              transform .85s cubic-bezier(.2,.7,.2,1);
}
.rv.in { opacity: 1; transform: none; }
```

```js
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  });
}, { threshold: .12, rootMargin: '0px 0px -60px' });

document.querySelectorAll('.rv').forEach((el, i) => {
  el.style.transitionDelay = Math.min(i % 6, 5) * 70 + 'ms';   // stagger
  io.observe(el);
});
```

Nothing unusual. The problem is the chain it creates for anything **above the fold**:

1. HTML arrives and parses — but the hero is `opacity: 0`, so nothing is visible
2. The browser must fetch and execute the JavaScript
3. `IntersectionObserver` initialises and fires its first callback
4. The stagger adds up to 350 ms of `transition-delay`
5. An 850 ms transition runs

Only at the end of all that does the browser consider the element painted. LCP is measured
when content actually appears on screen, so every millisecond of that sequence is counted
against you.

**I was animating content that was already on screen at load.** A reveal-on-scroll for
something you never scroll to is pure cost.

## The fix

Only animate what's below the fold. The reveal is stripped from the first section of every
page at build time:

```js
// The first section is already on screen at load — revealing it only delays LCP.
function unrevealHero(html) {
  const m = html.match(/<main id="main">\s*<section[^>]*>[\s\S]*?<\/section>/);
  if (!m) return html;
  const cleaned = m[0].replace(/class="([^"]*)"/g, (_, c) => {
    const kept = c.split(/\s+/).filter(x => x && x !== 'rv').join(' ');
    return kept ? `class="${kept}"` : '';
  });
  return html.replace(m[0], cleaned);
}
```

If you're not generating your HTML, the same idea in CSS — never let above-the-fold content
start at zero opacity:

```css
/* only elements below the initial viewport get the reveal */
.rv { opacity: 0; }
.hero .rv { opacity: 1; transform: none; transition: none; }
```

Everything further down the page still animates. Nothing about the design changed for a
visitor: the hero was supposed to be visible immediately anyway.

## The result

```
              before   after
Performance      69      99
FCP            3.0 s   1.1 s
LCP            6.5 s   2.0 s
Speed Index    3.5 s   1.4 s
```

Speed Index more than halved, because that metric measures how quickly the page *looks*
finished — and an invisible hero looks like nothing at all.

## What to take from this

- **Read the LCP breakdown, not just the number.** "Element render delay" points at your own
  code. TTFB and load time point at the network.
- **Your LCP element is often text.** People optimise images and miss a paragraph that's
  waiting on JavaScript.
- **`opacity: 0` is a promise not to paint.** Anything you hide by default, you are asking
  the browser to delay.
- **Reveal-on-scroll only makes sense for things you scroll to.** Applying it to the hero is
  paying a performance cost for an animation nobody sees begin.

One more, learned the hard way: always add `prefers-reduced-motion` handling to any of this.

```css
@media (prefers-reduced-motion: reduce) {
  .rv { opacity: 1; transform: none; }
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```
