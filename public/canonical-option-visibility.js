(() => {
  'use strict';

  const route = window.location.pathname.replace(/\/+$/, '') || '/';
  if (route !== '/app' && route !== '/app/new') return;

  const preferenceKeys = new Map([
    ['高精度翻訳', ['translation']],
    ['Agent Mode', ['agent_mode', 'agentMode']],
    ['書類作成', ['document']],
    ['外部Storage転送', ['storage_transfer', 'storageTransfer']],
  ]);
  let visibility = new Map(Array.from(preferenceKeys.keys(), (name) => [name, true]));
  let queued = false;

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const preferenceData = (payload) => {
    const root = record(payload);
    return record(root.preferences || root.data || root);
  };

  function applyVisibility() {
    document.querySelectorAll('.canon-picker:not(.canon-purpose-picker) .canon-switch-row').forEach((row) => {
      if (!(row instanceof HTMLElement)) return;
      const label = text(row.querySelector('.canon-switch-copy strong'));
      if (!visibility.has(label)) return;
      row.hidden = visibility.get(label) === false;
      row.setAttribute('aria-hidden', row.hidden ? 'true' : 'false');
    });
  }

  async function refreshPreferences() {
    try {
      const response = await fetch('/api/preferences', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;
      const data = preferenceData(await response.json());
      const next = new Map();
      preferenceKeys.forEach((keys, name) => {
        const found = keys.find((key) => Object.prototype.hasOwnProperty.call(data, key));
        next.set(name, found ? data[found] !== false : true);
      });
      visibility = next;
      applyVisibility();
    } catch {
      // Fail open for candidate visibility: entitlement is still enforced server-side.
    }
  }

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyVisibility();
    });
  };

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', () => void refreshPreferences());
  window.addEventListener('pageshow', () => void refreshPreferences());
  void refreshPreferences();
})();
