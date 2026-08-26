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
      detail: { preferences: { ...preferences } },
    }));
  }

  function applySidebarState() {
    document.querySelectorAll('.platform-sidebar-options').forEach((group) => {
      const inputs = Array.from(group.querySelectorAll('.platform-sidebar-option-toggle input[type="checkbox"]'));
      inputs.slice(0, OPTION_KEYS.length).forEach((input, index) => {
        if (!(input instanceof HTMLInputElement)) return;
        const key = OPTION_KEYS[index];
        input.checked = currentValue(key);
        if (input.dataset.optionPreferenceBound === 'true') return;
        input.dataset.optionPreferenceBound = 'true';
        input.addEventListener('change', async () => {
          const nextValue = input.checked;
          document.querySelectorAll('.platform-sidebar-options').forEach((peerGroup) => {
            const peerInputs = peerGroup.querySelectorAll('.platform-sidebar-option-toggle input[type="checkbox"]');
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

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applySidebarState();
    });
  };

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', () => void refreshPreferences());
  window.addEventListener('pageshow', () => void refreshPreferences());
  applySidebarState();
  void refreshPreferences();
})();
