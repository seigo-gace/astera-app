(() => {
  'use strict';

  const PIN_BATCH = 5;
  let refreshQueued = false;

  const locale = () => (document.documentElement.lang || navigator.language || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const copy = () => locale() === 'en'
    ? { pinned: 'Pinned', archive: 'Archive', empty: 'No pinned results', more: 'Show more', loading: 'Loading…' }
    : { pinned: 'ピン留め', archive: 'アーカイブ', empty: 'ピン留めはありません', more: 'さらに表示', loading: '読み込み中…' };

  function historyArray(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.history)) return payload.history;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  }

  function stringValue(record, keys, fallback = '') {
    if (!record || typeof record !== 'object') return fallback;
    for (const key of keys) {
      const value = record[key];
      if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
    }
    return fallback;
  }

  async function fetchPinned(cursor = '') {
    const params = new URLSearchParams({ scope: 'pinned', limit: String(PIN_BATCH) });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`/api/history?${params.toString()}`, {
      method: 'GET', credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`PINNED_HTTP_${response.status}`);
    return payload;
  }

  function pinIcon() {
    const icon = document.createElement('span');
    icon.className = 'sidebar-organization-icon is-pin';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function archiveIcon() {
    const icon = document.createElement('span');
    icon.className = 'sidebar-organization-icon is-archive';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function renderPinnedRow(item) {
    const id = stringValue(item, ['result_id', 'id']);
    if (!id) return null;
    const link = document.createElement('a');
    link.className = 'sidebar-pinned-result';
    link.href = `/app/results/${encodeURIComponent(id)}`;
    link.title = stringValue(item, ['title', 'name', 'prompt'], 'Result');
    link.textContent = link.title;
    return link;
  }

  function createPinnedSection() {
    const details = document.createElement('details');
    details.className = 'sidebar-pinned-section';
    details.dataset.sidebarPinnedSection = 'true';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'sidebar-pinned-heading';
    summary.append(pinIcon());
    const label = document.createElement('span');
    label.className = 'sidebar-pinned-label';
    label.textContent = copy().pinned;
    const chevron = document.createElement('span');
    chevron.className = 'sidebar-organization-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    summary.append(label, chevron);

    const list = document.createElement('div');
    list.className = 'sidebar-pinned-list';
    const state = document.createElement('span');
    state.className = 'sidebar-pinned-state';
    state.textContent = copy().loading;
    list.append(state);

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'sidebar-pinned-more';
    more.textContent = copy().more;
    more.hidden = true;

    let cursor = '';
    let loading = false;
    const load = async (append = false) => {
      if (loading) return;
      loading = true;
      more.disabled = true;
      try {
        const payload = await fetchPinned(append ? cursor : '');
        const items = historyArray(payload);
        if (!append) list.replaceChildren();
        for (const item of items) {
          const row = renderPinnedRow(item);
          if (row) list.append(row);
        }
        if (!list.children.length) {
          const empty = document.createElement('span');
          empty.className = 'sidebar-pinned-state';
          empty.textContent = copy().empty;
          list.append(empty);
        }
        cursor = typeof payload?.next_cursor === 'string' ? payload.next_cursor : '';
        more.hidden = payload?.has_more !== true || !cursor;
      } catch {
        if (!append) {
          list.replaceChildren();
          const empty = document.createElement('span');
          empty.className = 'sidebar-pinned-state';
          empty.textContent = copy().empty;
          list.append(empty);
        }
        more.hidden = true;
      } finally {
        loading = false;
        more.disabled = false;
      }
    };

    details.addEventListener('toggle', () => {
      if (details.open && !details.dataset.loaded) {
        details.dataset.loaded = 'true';
        void load(false);
      }
    });
    more.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void load(true);
    });
    details.addEventListener('astera:reload-pins', () => {
      details.dataset.loaded = 'true';
      cursor = '';
      void load(false);
    });

    details.append(summary, list, more);
    void load(false);
    details.dataset.loaded = 'true';
    return details;
  }

  function createArchiveButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sidebar-archive-trigger';
    button.dataset.sidebarArchiveTrigger = 'true';
    button.append(archiveIcon());
    const label = document.createElement('span');
    label.className = 'sidebar-archive-label';
    label.textContent = copy().archive;
    button.append(label);
    button.addEventListener('click', () => {
      window.AsteraHistorySearchOverlay?.open?.('archived', button);
    });
    return button;
  }

  function install(sidebar) {
    if (!(sidebar instanceof HTMLElement)) return;
    const nav = sidebar.querySelector('.platform-nav');
    if (!(nav instanceof HTMLElement)) return;

    const folder = nav.querySelector('[data-sidebar-project-section]');
    if (folder instanceof HTMLElement && !nav.querySelector('[data-sidebar-pinned-section]')) {
      folder.before(createPinnedSection());
    }

    const history = nav.querySelector('a[href="/app/history"]');
    if (history instanceof HTMLElement && !nav.querySelector('[data-sidebar-archive-trigger]')) {
      history.before(createArchiveButton());
    }
  }

  function refresh() {
    refreshQueued = false;
    document.querySelectorAll('.platform-sidebar, .platform-mobile-drawer').forEach(install);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(refresh);
  }

  window.addEventListener('astera:result-organization-changed', () => {
    document.querySelectorAll('[data-sidebar-pinned-section]').forEach((node) => {
      node.dispatchEvent(new Event('astera:reload-pins'));
    });
  });

  refresh();
  new MutationObserver(scheduleRefresh).observe(document.documentElement, { childList: true, subtree: true });
})();
