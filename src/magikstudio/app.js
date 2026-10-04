(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const toggle = document.querySelector('.motion-toggle');
  let paused = preference.matches;
  const syncMotion = () => {
    root.classList.toggle('motion-paused', paused);
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.textContent = paused ? 'Animations paused' : 'Pause animations';
    toggle.disabled = preference.matches;
    toggle.title = preference.matches ? 'Your device preference reduces motion.' : 'Toggle playful animations';
  };
  toggle.hidden = false;
  syncMotion();
  toggle.addEventListener('click', () => { paused = !paused; syncMotion(); });
  preference.addEventListener('change', () => { paused = preference.matches; syncMotion(); });
  const nav = document.getElementById('nav');
  const updateNav = () => nav.classList.toggle('stuck', scrollY > 15);
  addEventListener('scroll', updateNav, { passive: true });
  updateNav();
  const burger = document.querySelector('.burger');
  const menu = document.getElementById('mobmenu');
  function closeMenu() {
    menu.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open menu');
  }
  burger.addEventListener('click', () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    burger.setAttribute('aria-expanded', String(opening));
    burger.setAttribute('aria-label', opening ? 'Close menu' : 'Open menu');
  });
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); burger.focus(); } });
  matchMedia('(min-width: 761px)').addEventListener('change', event => { if (event.matches) closeMenu(); });
  if (!preference.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); }
    }), { threshold: .08 });
    document.querySelectorAll('.featured-game,.studio-grid,.values article,.section-heading,.contact-band,.about-story,.project-info').forEach(element => {
      element.classList.add('rv'); observer.observe(element);
    });
    root.classList.add('motion-ready');
  }
  const magic = document.querySelector('[data-magic]');
  if (magic) {
    let busy = false;
    let count = 0;
    const messages = ['A little more magik in your day!', 'A pocketful of happy!', 'One more smile, coming right up!'];
    magic.addEventListener('click', () => {
      if (busy) return;
      document.querySelector('.magic-feedback').textContent = messages[count++ % messages.length];
      if (paused || preference.matches) return;
      busy = true;
      magic.classList.add('is-popping');
      for (let i = 0; i < 8; i++) {
        const spark = document.createElement('span');
        spark.className = `magic-spark spark-${i}`;
        spark.textContent = i % 2 ? '✦' : '●';
        spark.setAttribute('aria-hidden', 'true');
        magic.append(spark);
      }
      setTimeout(() => {
        magic.classList.remove('is-popping');
        magic.querySelectorAll('.magic-spark').forEach(spark => spark.remove());
        busy = false;
      }, 950);
    });
  }
  const copy = document.querySelector('[data-copy-email]');
  if (copy) copy.addEventListener('click', async () => {
    const status = document.querySelector('.copy-feedback');
    try {
      await navigator.clipboard.writeText(copy.dataset.copyEmail);
      status.textContent = 'Email copied. Say hello whenever you’re ready!';
    } catch {
      status.textContent = 'Copy this address: ' + copy.dataset.copyEmail;
    }
  });
})();
