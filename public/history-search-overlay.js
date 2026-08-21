(() => {
  'use strict';

  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/app/search') {
    window.location.replace('/app/history');
    return;
  }

  const locale = () => (document.documentElement.lang || navigator.language || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const copy = () => locale() === 'en'
    ? {
        open: 'Search history',
        placeholder: 'Search...',
        recent: 'Recent',
        results: 'Search results',
        loading: 'Loading…',
        emptyRecent: 'No history yet',
        emptySearch: 'No matching history',
        error: 'Could not load history.',
        retry: 'Retry',
        close: 'Close search',
      }
    : {
        open: '履歴を検索',
        placeholder: '検索...',
        recent: '最近の履歴',
        results: '検索結果',
        loading: '読み込み中…',
        emptyRecent: 'まだ履歴がありません',
        emptySearch: '一致する履歴はありません',
        error: '履歴を取得できませんでした。',
        retry: '再試行',
        close: '検索を閉じる',
      };

  let overlay = null;
  let panel = null;
  let input = null;
  let resultHost = null;
  let heading = null;
  let returnFocus = null;
  let requestController = null;
  let debounceTimer = 0;
  let selectedIndex = -1;
  let currentItems = [];
  let composing = false;

  const focusableElements = (root) => Array.from(root.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  )).filter((node) => {
    if (!(node instanceof HTMLElement) || node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  function historyArray(payload) {
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.history)) return payload.history;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.results)) return payload.results;
    const history = payload.history && typeof payload.history === 'object' ? payload.history : null;
    if (history && Array.isArray(history.items)) return history.items;
    if (history && Array.isArray(history.results)) return history.results;
    return [];
  }

  function stringValue(record, keys) {
    if (!record || typeof record !== 'object') return '';
    for (const key of keys) {
      const value = record[key];
      if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
    }
    return '';
  }

  function normalizeItems(payload) {
    return historyArray(payload).flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return [];
      const id = stringValue(entry, ['result_id', 'id']);
      if (!id) return [];
      const title = stringValue(entry, ['title', 'prompt', 'name']) || `Result ${index + 1}`;
      return [{ id, title }];
    });
  }

  function setSelected(index) {
    const rows = Array.from(resultHost?.querySelectorAll('.history-search-result') || []);
    if (!rows.length) {
      selectedIndex = -1;
      input?.removeAttribute('aria-activedescendant');
      return;
    }
    selectedIndex = Math.max(0, Math.min(index, rows.length - 1));
    rows.forEach((row, rowIndex) => {
      row.classList.toggle('is-active', rowIndex === selectedIndex);
      row.setAttribute('aria-selected', rowIndex === selectedIndex ? 'true' : 'false');
    });
    input?.setAttribute('aria-activedescendant', rows[selectedIndex].id);
  }

  function openItem(item) {
    closeOverlay();
    window.location.assign(`/app/results/${encodeURIComponent(item.id)}`);
  }

  function renderState(type, message, retryQuery = null) {
    if (!resultHost) return;
    resultHost.replaceChildren();
    const state = document.createElement('div');
    state.className = `history-search-state${type === 'error' ? ' is-error' : ''}`;
    state.setAttribute(type === 'error' ? 'role' : 'aria-live', type === 'error' ? 'alert' : 'polite');
    const label = document.createElement(type === 'error' ? 'strong' : 'span');
    label.textContent = message;
    state.append(label);
    if (retryQuery !== null) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = copy().retry;
      retry.addEventListener('click', () => void load(retryQuery));
      state.append(retry);
    }
    resultHost.append(state);
    setSelected(-1);
  }

  function renderItems(items, query) {
    if (!resultHost) return;
    resultHost.replaceChildren();
    currentItems = items;
    if (!items.length) {
      renderState('empty', query ? copy().emptySearch : copy().emptyRecent);
      return;
    }
    const list = document.createElement('div');
    list.className = 'history-search-results';
    list.id = 'history-search-results';
    list.setAttribute('role', 'listbox');
    items.forEach((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.id = `history-search-result-${index}`;
      row.className = 'history-search-result';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      const mark = document.createElement('span');
      mark.className = 'history-search-result-mark';
      mark.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      title.className = 'history-search-result-title';
      title.textContent = item.title;
      row.append(mark, title);
      row.addEventListener('pointermove', () => setSelected(index));
      row.addEventListener('focus', () => setSelected(index));
      row.addEventListener('click', () => openItem(item));
      list.append(row);
    });
    resultHost.append(list);
    setSelected(0);
  }

  async function load(query) {
    if (!overlay || overlay.hidden) return;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    renderState('loading', copy().loading);
    const params = new URLSearchParams({ limit: '20' });
    if (query) params.set('q', query);
    try {
      const response = await fetch(`/api/history?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`HISTORY_HTTP_${response.status}`);
      if (controller.signal.aborted) return;
      renderItems(normalizeItems(payload), query);
    } catch (error) {
      if (controller.signal.aborted) return;
      renderState('error', copy().error, query);
    }
  }

  function scheduleSearch() {
    window.clearTimeout(debounceTimer);
    requestController?.abort();
    const query = input?.value.trim() || '';
    if (heading) heading.textContent = query ? copy().results : copy().recent;
    if (!query) {
      void load('');
      return;
    }
    renderState('loading', copy().loading);
    debounceTimer = window.setTimeout(() => void load(query), 250);
  }

  function closeOverlay() {
    if (!overlay || overlay.hidden) return;
    window.clearTimeout(debounceTimer);
    requestController?.abort();
    overlay.hidden = true;
    document.documentElement.classList.remove('history-search-open');
    const target = returnFocus;
    returnFocus = null;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
      else document.querySelector('.platform-menu-button')?.focus();
    });
  }

  function openOverlay(trigger) {
    ensureOverlay();
    const inMobileDrawer = Boolean(trigger.closest('#platform-mobile-drawer'));
    returnFocus = inMobileDrawer ? document.querySelector('.platform-menu-button') : trigger;
    if (inMobileDrawer) document.querySelector('.platform-backdrop')?.click();
    overlay.hidden = false;
    document.documentElement.classList.add('history-search-open');
    input.value = '';
    heading.textContent = copy().recent;
    input.placeholder = copy().placeholder;
    input.setAttribute('aria-label', copy().open);
    panel.setAttribute('aria-label', copy().open);
    panel.querySelector('.history-search-close')?.setAttribute('aria-label', copy().close);
    window.requestAnimationFrame(() => input.focus());
    void load('');
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'history-search-overlay';
    overlay.hidden = true;

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'history-search-backdrop';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', copy().close);
    backdrop.addEventListener('click', closeOverlay);

    panel = document.createElement('section');
    panel.className = 'history-search-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', copy().open);

    const header = document.createElement('header');
    header.className = 'history-search-header';

    input = document.createElement('input');
    input.className = 'history-search-input';
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = copy().placeholder;
    input.setAttribute('aria-label', copy().open);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'history-search-results');
    input.addEventListener('input', scheduleSearch);
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', (event) => {
      if (!currentItems.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((selectedIndex + 1) % currentItems.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((selectedIndex - 1 + currentItems.length) % currentItems.length);
      } else if (event.key === 'Enter' && !composing && !event.isComposing && selectedIndex >= 0) {
        event.preventDefault();
        openItem(currentItems[selectedIndex]);
      }
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'history-search-close';
    close.setAttribute('aria-label', copy().close);
    close.textContent = '×';
    close.addEventListener('click', closeOverlay);
    header.append(input, close);

    const body = document.createElement('div');
    body.className = 'history-search-body';
    heading = document.createElement('div');
    heading.className = 'history-search-heading';
    heading.textContent = copy().recent;
    resultHost = document.createElement('div');
    resultHost.className = 'history-search-result-host';
    body.append(heading, resultHost);
    panel.append(header, body);
    overlay.append(backdrop, panel);
    document.body.append(overlay);

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOverlay();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(panel);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function removeLegacySearchLinks(root = document) {
    root.querySelectorAll('a[href="/app/search"]').forEach((link) => link.remove());
  }

  function installTrigger(sidebar) {
    if (!(sidebar instanceof HTMLElement) || sidebar.querySelector('[data-history-search-trigger]')) return;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'history-search-trigger';
    trigger.dataset.historySearchTrigger = 'true';
    trigger.setAttribute('aria-label', copy().open);
    const icon = document.createElement('span');
    icon.className = 'history-search-icon';
    icon.setAttribute('aria-hidden', 'true');
    trigger.append(icon);
    trigger.addEventListener('click', () => openOverlay(trigger));
    const brand = sidebar.querySelector('.platform-brand');
    if (brand) brand.after(trigger);
    else sidebar.prepend(trigger);
  }

  function refresh() {
    removeLegacySearchLinks();
    document.querySelectorAll('.platform-sidebar, .platform-mobile-drawer').forEach(installTrigger);
  }

  ensureOverlay();
  refresh();
  new MutationObserver(refresh).observe(document.documentElement, { childList: true, subtree: true });
})();
