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
