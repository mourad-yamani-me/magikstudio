(function(){
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* sticky nav */
  var nav = document.getElementById('nav');
  if (nav) addEventListener('scroll', function(){ nav.classList.toggle('stuck', scrollY > 20); }, {passive:true});

  /* mobile menu */
  var burger = document.querySelector('.burger'), mm = document.getElementById('mobmenu');
  if (burger && mm) burger.addEventListener('click', function(){
    var open = mm.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
  });

  /* scroll reveal */
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  }, {threshold:.1, rootMargin:'0px 0px -60px'});
  document.querySelectorAll('.rv').forEach(function(el,i){
    el.style.transitionDelay = Math.min(i % 6, 5) * 70 + 'ms';
    io.observe(el);
  });

  /* screenshot galleries */
  document.querySelectorAll('[data-gallery]').forEach(function(g){
    var imgs = g.querySelectorAll('img');
    if (imgs.length < 2) return;
    var dots = g.parentElement.querySelector('.gdots'), i = 0, timer, onscreen = false;
    imgs.forEach(function(_, n){
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Screenshot ' + (n+1));
      if (!n) b.className = 'on';
      b.addEventListener('click', function(){ go(n); restart(); });
      dots.appendChild(b);
    });
    function go(n){
      // The four slides underneath are opacity:0 but still in the accessibility
      // tree, so a screen reader read five screenshots where one is visible.
      imgs[i].classList.remove('on'); imgs[i].setAttribute('aria-hidden', 'true');
      dots.children[i].classList.remove('on');
      i = n;
      imgs[i].classList.add('on'); imgs[i].removeAttribute('aria-hidden');
      dots.children[i].classList.add('on');
    }
    /* A gallery nobody can see has no business waking the main thread every
       3.4s to swap a class, and the home page runs five of them at once. The
       observer fires on observe(), so it also does the initial start. */
    function restart(){
      clearInterval(timer);
      timer = (!reduce && onscreen && !document.hidden)
        ? setInterval(function(){ go((i+1)%imgs.length); }, 3400) : 0;
    }
    new IntersectionObserver(function(es){ onscreen = es[0].isIntersecting; restart(); })
      .observe(g);
    document.addEventListener('visibilitychange', restart);
  });

  /* hero parallax */
  /* pointermove fires faster than the screen refreshes, and this handler both
     measures (getBoundingClientRect) and writes (style.transform) — so every
     event forced a synchronous layout. Coalescing to one frame turns a burst
     of events into a single read and a single write. */
  var phones = document.getElementById('phones');
  if (phones && !reduce) {
    var plist = [].slice.call(phones.querySelectorAll('.phone')), pt = null, frame = 0;
    phones.addEventListener('pointermove', function(e){
      pt = e;
      if (frame) return;
      frame = requestAnimationFrame(function(){
        frame = 0;
        var r = phones.getBoundingClientRect();
        var x = (pt.clientX - r.left)/r.width - .5, y = (pt.clientY - r.top)/r.height - .5;
        plist.forEach(function(p){
          var d = +p.dataset.depth || 20;
          p.style.transform = 'translate3d(' + (-x*d) + 'px,' + (-y*d) + 'px,0)';
          p.style.animationPlayState = 'paused';
        });
      });
    }, {passive:true});
    phones.addEventListener('pointerleave', function(){
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      plist.forEach(function(p){ p.style.transform=''; p.style.animationPlayState=''; });
    }, {passive:true});
  }

  /* card cursor glow */
  document.querySelectorAll('[data-tilt]').forEach(function(c){
    var at = null, f = 0;
    c.addEventListener('pointermove', function(e){
      at = e;
      if (f) return;
      f = requestAnimationFrame(function(){
        f = 0;
        var r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (at.clientX - r.left)+'px');
        c.style.setProperty('--my', (at.clientY - r.top)+'px');
      });
    }, {passive:true});
  });

  /* TOC scroll-spy */
  var toc = document.querySelector('.toc');
  if (toc) {
    var links = [].slice.call(toc.querySelectorAll('a'));
    var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
    var sio = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (!e.isIntersecting) return;
        links.forEach(function(a){ a.classList.toggle('on', a.getAttribute('href') === '#'+e.target.id); });
      });
    }, {rootMargin:'-90px 0px -70% 0px'});
    secs.forEach(function(s){ sio.observe(s); });
  }

  /* gist:lightbox-js */
  /* screenshot lightbox */
  var groups = document.querySelectorAll('[data-lightbox]');
  if (groups.length) {
    var lb = document.createElement('div');
    lb.className = 'lb';
    // It behaves as a modal, so it has to say so: without these a screen
    // reader announces the buttons with no indication that a dialog opened or
    // that the page behind it is out of play.
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Screenshot viewer');
    lb.innerHTML =
      '<figure class="lb-fig"><img alt="" hidden></figure>' +
      '<button class="lb-prev" aria-label="Previous screenshot"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<button class="lb-next" aria-label="Next screenshot"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>' +
      '<button class="lb-close" aria-label="Close"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="lb-count"></div>';
    document.body.appendChild(lb);

    var img = lb.querySelector('img'), count = lb.querySelector('.lb-count');
    var shots = [], idx = 0, opener = null;

    function show(n){
      idx = (n + shots.length) % shots.length;
      var src = shots[idx];
      img.hidden = false;
      // data-full is the WebP of the same shot; src is the JPEG fallback and
      // costs about three times as much for a picture the browser can already
      // decode. Fall back to src where no WebP was built.
      img.src = src.dataset.full || src.src;
      img.alt = src.alt;
      count.textContent = (idx + 1) + ' / ' + shots.length;
    }
    function open(group, n){
      shots = [].slice.call(group.querySelectorAll('img'));
      opener = group.querySelectorAll('.shot')[n];
      show(n);
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
      // .lb.open makes it visible with no transition delay, so this focus
      // lands. Give visibility a duration instead and it is dropped silently.
      lb.querySelector('.lb-close').focus();
    }
    function close(){
      lb.classList.remove('open');
      document.body.style.overflow = '';
      if (opener) opener.focus();
    }

    groups.forEach(function(g){
      g.addEventListener('click', function(e){
        var b = e.target.closest('.shot');
        if (b) open(g, +b.dataset.i);
      });
    });
    lb.querySelector('.lb-prev').addEventListener('click', function(){ show(idx - 1); });
    lb.querySelector('.lb-next').addEventListener('click', function(){ show(idx + 1); });
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.addEventListener('click', function(e){ if (e.target === lb) close(); });
    addEventListener('keydown', function(e){
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'Tab') {
        /* Keep Tab inside the dialog. Without this it walks straight out into
           the page behind, which is still fully rendered underneath — the
           reason aria-modal alone is not enough. */
        var f = lb.querySelectorAll('button');
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* /gist:lightbox-js */

  /* trailer facade — the YouTube player is only created on click, so the page
     makes no third-party request unless someone actually wants the video */
  document.querySelectorAll('[data-trailer]').forEach(function(b){
    b.addEventListener('click', function(){
      var id = b.getAttribute('data-trailer');
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
      f.title = b.getAttribute('aria-label') || 'Gameplay trailer';
      f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      f.allowFullscreen = true;
      var wrap = document.createElement('div');
      wrap.className = 'trailer';
      wrap.appendChild(f);
      b.replaceWith(wrap);
      f.focus();
    });
  });


  /* signup provenance — narrows the hidden "source" field from the channel
     ("web") to the page that linked here, read from ?from= on the link. The
     field already holds a valid default, so with JavaScript off the form still
     posts something true; this only makes it more specific.

     The value is sanitised rather than trusted: it lands in a mailing-list
     record, and anyone can put anything after ?from=. A short slug is the only
     shape a real link produces, so anything else is discarded. */
  var srcField = document.getElementById('sub-source');
  if (srcField) {
    var from = new URLSearchParams(location.search).get('from');
    if (from && /^[a-z0-9][a-z0-9-]{0,39}$/.test(from)) srcField.value = from;
  }


  /* mailing-list invitation — shown once, to someone who is actually reading.

     Everything here is deliberately conservative. It appears only past 60% of
     the page, never moves the layout (position:fixed), never takes focus, and
     closes on Escape as well as the button. Dismissing writes one flag; so
     does clicking through, because someone on their way to the form does not
     need asking again.

     The flag is the only thing this site stores on a device, and it exists to
     honour a refusal — without it the invitation returns on the next page,
     which is the version worth avoiding. Every storage call is guarded:
     private windows and blocked site data make these throw, and an invitation
     that cannot remember a dismissal must not appear at all. */
  var invite = document.getElementById('mlInvite');
  if (invite) {
    var KEY = 'icd-ml-dismissed';
    var store = function (fn, fallback) {
      try { return fn(); } catch (e) { return fallback; }
    };
    var seen = store(function () { return localStorage.getItem(KEY); }, 'blocked');

    if (!seen) {
      var dismiss = function () {
        invite.classList.remove('in');
        store(function () { return localStorage.setItem(KEY, '1'); });
        setTimeout(function () { invite.hidden = true; }, 450);
        document.removeEventListener('keydown', onKey);
      };
      var onKey = function (e) { if (e.key === 'Escape' && !invite.hidden) dismiss(); };

      invite.querySelector('[data-ml-close]').addEventListener('click', dismiss);
      // Clicking through counts as answered: remember it, but let the link go.
      invite.querySelector('[data-ml-go]').addEventListener('click', function () {
        store(function () { return localStorage.setItem(KEY, '1'); });
      });
      document.addEventListener('keydown', onKey);

      var onScroll = function () {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        if (max <= 0) return;
        if ((h.scrollTop || document.body.scrollTop) / max < 0.6) return;
        window.removeEventListener('scroll', onScroll);
        invite.hidden = false;
        requestAnimationFrame(function () { invite.classList.add('in'); });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

})();
