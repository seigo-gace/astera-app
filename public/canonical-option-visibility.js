(() => {
  'use strict';

  const route = window.location.pathname.replace(/\/+$/, '') || '/';
  if (!route.startsWith('/app')) return;

  const OPTION_KEYS = ['translation', 'agent_mode', 'storage_transfer'];
  let preferences = null;
  let request = null;
  let scheduled = false;

  const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const preferenceData = (payload) => {
    const root = record(payload);
    return record(root.preferences || root.data || root);
  };

  function currentValue(key) {
    if (!preferences) return true;
    return preferences[key] !== false;
  }

  function broadcast() {
    window.dispatchEvent(new CustomEvent('astera:option-preferences', {
      detail: { preferences: { ...(preferences || {}) } },
    }));
  }

  function sidebarGroups() {
    return Array.from(document.querySelectorAll('.platform-sidebar-options'));
  }

  function activeSidebarGroup() {
    const groups = sidebarGroups();
    return groups.find((group) => group instanceof HTMLElement && group.getClientRects().length > 0) || groups[0] || null;
  }

  function sidebarInputs(group) {
    if (!(group instanceof Element)) return [];
    return Array.from(group.querySelectorAll('.platform-sidebar-option-toggle input[type="checkbox"]'))
      .filter((input) => input instanceof HTMLInputElement)
      .slice(0, OPTION_KEYS.length);
  }

  function syncPreferenceStateFromVisibleSidebar() {
    const inputs = sidebarInputs(activeSidebarGroup());
    if (inputs.length !== OPTION_KEYS.length) return false;
    const next = { ...(preferences || {}) };
    OPTION_KEYS.forEach((key, index) => {
      next[key] = inputs[index].checked;
    });
    preferences = next;
    broadcast();
    return true;
  }

  function applySidebarState() {
    sidebarGroups().forEach((group) => {
      const inputs = sidebarInputs(group);
      inputs.forEach((input, index) => {
        const key = OPTION_KEYS[index];
        input.checked = currentValue(key);
        if (input.dataset.optionPreferenceBound === 'true') return;
        input.dataset.optionPreferenceBound = 'true';
        input.addEventListener('change', async () => {
          const nextValue = input.checked;
          sidebarGroups().forEach((peerGroup) => {
            const peerInputs = sidebarInputs(peerGroup);
            const peer = peerInputs[index];
            if (peer instanceof HTMLInputElement) peer.checked = nextValue;
          });
          preferences = { ...(preferences || {}), [key]: nextValue };
          broadcast();
          try {
            const response = await fetch('/api/preferences', {
              method: 'PATCH',
              credentials: 'include',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify({ [key]: nextValue }),
              cache: 'no-store',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            preferences = preferenceData(await response.json());
            applySidebarState();
            broadcast();
          } catch {
            await refreshPreferences(true);
          }
        });
      });
    });
  }

  async function refreshPreferences(force = false) {
    if (request && !force) return request;
    request = (async () => {
      try {
        const response = await fetch('/api/preferences', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) return;
        preferences = preferenceData(await response.json());
        applySidebarState();
        broadcast();
      } catch {
        applySidebarState();
      } finally {
        request = null;
      }
    })();
    return request;
  }

  function onComposerEntryPointer(event) {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.getAttribute('aria-label') !== 'Fileと実行Optionを追加') return;
    syncPreferenceStateFromVisibleSidebar();
  }

  function onComposerEntryKey(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== '/' && event.key !== '@') return;
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.getAttribute('aria-label') !== 'Astera入力') return;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    if (start !== end || (start > 0 && !/\s/.test(target.value[start - 1] || ''))) return;
    syncPreferenceStateFromVisibleSidebar();
  }

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applySidebarState();
    });
  };

  document.addEventListener('pointerdown', onComposerEntryPointer, true);
  document.addEventListener('keydown', onComposerEntryKey, true);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', () => void refreshPreferences());
  window.addEventListener('pageshow', () => void refreshPreferences());
  applySidebarState();
  void refreshPreferences();
})();
