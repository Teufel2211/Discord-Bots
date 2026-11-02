(() => {
  const cache = new Map();
  const TTL = 30000;
  let activeRequest = 0;
  const getCached = (url) => {
    const item = cache.get(url);
    if (!item || Date.now() - item.time > TTL) { cache.delete(url); return null; }
    return item.html;
  };
  async function load(url, push = true) {
    const id = ++activeRequest;
    document.body.classList.add('page-loading');
    try {
      let html = getCached(url);
      if (!html) {
        const response = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'dashboard-nav' } });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        html = await response.text();
        cache.set(url, { html, time: Date.now() });
      }
      if (id !== activeRequest) return;
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const nextMain = parsed.querySelector('main');
      if (!nextMain) { window.location.href = url; return; }
      document.querySelector('main')?.replaceWith(nextMain);
      document.title = parsed.title || document.title;
      document.querySelectorAll('.sidebar nav a').forEach(a => {
        const target = new URL(a.href, location.href).pathname;
        a.classList.toggle('active', target === new URL(url, location.href).pathname);
      });
      if (push) history.pushState({ url }, '', url);
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (error) {
      console.error('[BWW Dashboard] Navigation failed:', error);
      window.location.href = url;
    } finally {
      if (id === activeRequest) document.body.classList.remove('page-loading');
    }
  }
  function prefetch(url) {
    if (getCached(url) || cache.has(url)) return;
    const entry = { time: Date.now(), html: null };
    cache.set(url, entry);
    fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'dashboard-prefetch' } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(html => cache.set(url, { time: Date.now(), html }))
      .catch(() => cache.delete(url));
  }
  document.addEventListener('pointerover', event => {
    const link = event.target.closest('.sidebar nav a');
    if (link) prefetch(link.href);
  });
  document.addEventListener('focusin', event => {
    const link = event.target.closest('.sidebar nav a');
    if (link) prefetch(link.href);
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('.sidebar nav a');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    load(url.pathname + url.search);
  });
  window.addEventListener('popstate', () => load(location.pathname + location.search, false));
})();