/* Background playback is optional; the full trailer loads only on request. */
(() => {
  'use strict';
  const dialog = document.getElementById('trailer-dialog');
  const trailer = dialog.querySelector('video');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let film, toggle, observer, controller, userPaused = false, inView = true;

  function updateButton() {
    if (!toggle) return;
    const paused = !film || film.paused;
    toggle.innerHTML = `<span aria-hidden="true">${paused ? '&#9654;' : '&#10074;&#10074;'}</span> ${paused ? 'Play background' : 'Pause background'}`;
    toggle.setAttribute('aria-label', paused ? 'Play background video' : 'Pause background video');
  }
  function mayPlay() { return film && !userPaused && inView && !document.hidden && !dialog.open; }
  function refresh() {
    if (!film) return;
    if (mayPlay()) film.play().catch(updateButton);
    else film.pause();
    updateButton();
  }
  function loadFilm() {
    if (!film || film.querySelector('source')) return;
    const source = document.createElement('source');
    source.src = matchMedia('(max-width: 800px)').matches ? '/assets/media/haven-background-720.mp4' : '/assets/media/haven-background-1080.mp4';
    source.type = 'video/mp4'; film.append(source); film.load();
  }
  function clear() {
    observer?.disconnect(); controller?.abort();
    if (film) { film.pause(); film.removeAttribute('src'); film.replaceChildren(); film.load(); }
    film = toggle = observer = controller = null;
    if (dialog.open) dialog.close();
    trailer.pause();
  }
  function mount() {
    clear();
    film = document.querySelector('.hero-film'); toggle = document.querySelector('[data-hero-playback]');
    if (!film || !toggle) return;
    controller = new AbortController(); const options = {signal:controller.signal};
    film.muted = true; userPaused = motion.matches || Boolean(navigator.connection?.saveData); inView = true;
    film.addEventListener('playing', () => { film?.classList.add('is-ready'); updateButton(); }, options);
    film.addEventListener('pause', updateButton, options);
    film.addEventListener('error', () => { film?.classList.remove('is-ready'); updateButton(); }, options);
    toggle.addEventListener('click', () => { userPaused = !film.paused; if (!userPaused) loadFilm(); refresh(); }, options);
    document.querySelector('[data-watch-trailer]').addEventListener('click', () => {
      if (!trailer.querySelector('source').src) { const source = trailer.querySelector('source'); source.src = source.dataset.src; trailer.load(); }
      dialog.showModal(); film.pause(); trailer.currentTime = 0; trailer.play().catch(() => {});
    }, options);
    observer = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; refresh(); }, {threshold:0.05});
    observer.observe(document.querySelector('.hero-cinema'));
    if (!userPaused) loadFilm();
    refresh();
  }
  dialog.querySelector('.trailer-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { trailer.pause(); refresh(); });
  document.addEventListener('visibilitychange', refresh);
  motion.addEventListener('change', () => { if (motion.matches) { userPaused = true; refresh(); } });
  window.RiftTrailer = {mount, clear};
})();
