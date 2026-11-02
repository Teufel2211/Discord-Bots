(() => {
  const cache = new Map();
  const pending = new Map();
  const TTL = 30000;
  let activeRequest = 0;
  const getCached = url => {
    const item = cache.get(url);
    if (!item || Date.now() - item.time > TTL) { cache.delete(url); return null; }
    return item.html;
  };
  function requestPage(url) {
    if (pending.has(url)) return pending.get(url);
    const task = fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'dashboard-nav' } })
      .then(response => { if (!response.ok) throw new Error('HTTP ' + response.status); return response.text(); })
      .then(html => { cache.set(url, { html, time: Date.now() }); return html; })
      .finally(() => pending.delete(url));
    pending.set(url, task);
    return task;
  }
  async function load(url, push = true) {
    const id = ++activeRequest;
    document.body.classList.add('page-loading');
    try {
      const html = getCached(url) || await requestPage(url);
      if (id !== activeRequest) return;
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const nextMain = parsed.querySelector('main');
      if (!nextMain) { window.location.href = url; return; }
      document.querySelector('main')?.replaceWith(nextMain);
      document.title = parsed.title || document.title;
      document.querySelectorAll('.sidebar nav a').forEach(link => {
        link.classList.toggle('active', new URL(link.href, location.href).pathname === new URL(url, location.href).pathname);
      });
      if (push) history.pushState({ url }, '', url);
      window.scrollTo(0, 0);
    } catch (error) {
      console.error('[BWW Dashboard] Navigation failed:', error);
      window.location.href = url;
    } finally {
      if (id === activeRequest) document.body.classList.remove('page-loading');
    }
  }
  function prefetch(url) {
    if (getCached(url) || pending.has(url)) return;
    requestPage(url).catch(() => {});
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