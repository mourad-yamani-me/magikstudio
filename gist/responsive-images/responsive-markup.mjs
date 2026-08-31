/* add intrinsic width/height (stops layout shift) and serve WebP with a JPEG fallback */
function enhanceImages(html){
  return html.replace(/<img ([^>]*?)src="\/assets\/games\/([^"]+\.jpg)"([^>]*?)>/g, (m, pre, file, post) => {
    const d = DIMS[file];
    const hasWH = /\bwidth=/.test(pre + post);
    const wh = (d && !hasWH) ? ` width="${d.w}" height="${d.h}"` : '';
    const attrs = pre + post + wh;

    // A lazy image is by definition not the LCP element, so let its decode go
    // off the main thread. The hero deliberately keeps the synchronous default.
    const dec = (/loading="lazy"/.test(attrs) && !/\bdecoding=/.test(attrs))
      ? ' decoding="async"' : '';
    const img = `<img ${pre}src="/assets/games/${file}"${post}${wh}${dec}>`;

    if (!HAS_WEBP) return img;

    const base = file.replace(/\.jpg$/,'');
    const p = `/assets/games/${base}`;
    const isFeature = /-feature$/.test(base);
    const isIcon    = /-icon$/.test(base);
    // data-hero is the three floating phones on the home page and nothing else.
    // It used to mark the game-page carousel too, which is a different width
    // (a constant 254px against the phones' 154-242px), so one of the two was
    // always sized for the other's layout.
    const isHero    = /\bdata-hero\b/.test(attrs);
    const isShot    = /-\d+$/.test(base);

    // The slot an icon fills depends on the template — 56px on the home rows,
    // 88px on a game header, 60px on the related-games cards — and the <img>
    // already carries the real number. Reading it beats a hand-written sizes
    // string that is necessarily wrong for two of the three.
    const iconPx = +(/\bwidth="(\d+)"/.exec(attrs)?.[1] || 56);

    // The screenshot grid on a game page carries its own layout, because it is
    // the same file as the carousel but rendered at a completely different
    // width — 116px in a five-across grid on a tablet against the carousel's
    // constant 254px. One shared sizes string could only ever be right for one
    // of them, and it was right for neither.
    const grid = /\bdata-shot="(\d+):(\d+)"/.exec(attrs);

    // The hero stays at 200/320 on purpose: it is the LCP element on the home
    // page, and offering it a 400w candidate makes the one image on the
    // critical path bigger to fix a sharpness nobody reported.
    //
    // The carousel stops at 400w for a related reason. Its slot is 254px at
    // every breakpoint, so 400w is already ~1.6x — past the point anyone can
    // see on a screenshot — while the 506w original costs 40% more bytes for
    // an image that sits below the fold.
    // The grid and the carousel share one ladder on purpose. A game page renders
    // the same five screenshots twice, so ladders that disagree make the browser
    // fetch every shot twice — capping only one of them measured 397 -> 578 KiB.
    const set = isFeature ? [[`${p}-400`, 400], [`${p}-640`, 640],
                             [`${p}-880`, 880], [p, 1024]]
              : isIcon    ? [[`${p}-112`, 112], [`${p}-176`, 176]]
              : (isHero || grid || isShot)
                          ? [[`${p}-200`, 200], [`${p}-320`, 320]]
              : null;

    // .keyart fills .shell, which is min(100vw,1240) minus 48px of padding.
    // The old string claimed 100vw and so fetched the 1024w file for a slot
    // measuring 362px on a phone.
    const sizes = isFeature ? '(max-width:1288px) calc(100vw - 48px), 1192px'
                : isIcon    ? `${iconPx}px`
                : isHero    ? '(max-width:560px) 180px, 242px'
                : grid      ? shotsSizes(+grid[1], +grid[2])
                : isShot    ? '254px'
                : '';

    // The lightbox opens the full-size image, and app.js used to read it from
    // the <img> src — which is the JPEG fallback, so every enlarge pulled 217 KB
    // when a 70 KB WebP of the same picture was already sitting in dist/.
    const full = grid ? ` data-full="${p}.webp"` : '';

    const srcset = set ? set.map(([u, w]) => `${u}.webp ${w}w`).join(', ') : `${p}.webp`;
    const source = `<source type="image/webp" srcset="${srcset}"`
      + (sizes ? ` sizes="${sizes}"` : '') + '>';
    return `<picture>${source}${img.replace('<img ', '<img' + full + ' ')}</picture>`;
  });
}
