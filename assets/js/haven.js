/* Shared navigation, portrait resilience, and keyboard controls. */
(() => {
  'use strict';
  const main = document.getElementById('main');
  const atlas = document.querySelector('.atlas-nav');
  const game = document.querySelector('.nav-game');
  const gameButton = game.querySelector('button');
  const gameMenu = document.getElementById('game-menu');
  const menuButton = document.querySelector('.menu-toggle');
  let frame;

  function sync() {
    const root = location.pathname.split('/').filter(Boolean)[0] || '';
    const home = !root || root === 'index.html';
    const section = ({profile:'profiles',wiki:'guide',start:'guide'})[root] || root;
    document.body.dataset.view = home ? 'landing' : section;
    atlas.hidden = home;
    for (const link of document.querySelectorAll('.atlas-links a, .main-nav a')) {
      const current = link.pathname.split('/')[1] === section;
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const inExplore = ['guide','items','npcs','dungeons','status','profiles','guilds','rankings'].includes(section);
    gameButton.classList.toggle('is-current', inExplore);
    const tabs = main.querySelector('.path-tabs');
    if (tabs) tabs.setAttribute('aria-orientation', 'horizontal');
    if (home) document.title = 'Rift Haven — A world to explore. A place to call home.';
    else {
      const heading = main.querySelector('h1');
      if (heading?.textContent.trim()) document.title = heading.textContent.trim() + ' — Rift Haven';
    }
  }

  new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(sync);
  }).observe(main, {childList:true, subtree:true});
  window.addEventListener('popstate', sync);
  sync();

  function closeExplore() {
    gameMenu.hidden = true;
    gameButton.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', event => {
    if (!game.contains(event.target)) closeExplore();
    if (event.target.closest('a[data-route]') && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      menuButton.setAttribute('aria-label', 'Open navigation');
      main.focus({preventScroll:true});
    }
  });
  game.addEventListener('focusout', event => {
    if (!game.contains(event.relatedTarget)) closeExplore();
  });
  new MutationObserver(() => {
    menuButton.setAttribute('aria-label', menuButton.getAttribute('aria-expanded') === 'true' ? 'Close navigation' : 'Open navigation');
  }).observe(menuButton, {attributes:true, attributeFilter:['aria-expanded']});

  // A stale or not-yet-rendered appearance should never leave a broken-image box.
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !new URL(img.src).pathname.startsWith('/assets/avatars/')) return;
    img.onerror = null;
    img.src = '/assets/images/character.webp';
  }, true);

  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
  });

  document.getElementById('site-search').addEventListener('keydown', event => {
    const result = event.target.closest('.search-result');
    if (!result || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const results = [...document.querySelectorAll('#site-search .search-result')];
    const index = results.indexOf(result);
    if (event.key === 'ArrowUp' && index === 0) document.getElementById('site-search-input').focus();
    else {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? results.length - 1 : Math.max(0,Math.min(results.length - 1,index + (event.key === 'ArrowDown' ? 1 : -1)));
      results[next]?.focus();
    }
  });
})();
