(() => {
  'use strict';

  const route = window.location.pathname.replace(/\/+$/, '') || '/';
  const isComposerRoute = route === '/app' || route === '/app/new';
  const isOptionSettingsRoute = route === '/app/settings/options';
  if (!isComposerRoute && !isOptionSettingsRoute) return;

  const CURRENT_OPTIONS = new Map([
    ['高精度翻訳', ['translation']],
    ['Agent Mode', ['agent_mode', 'agentMode']],
    ['外部Storage転送', ['storage_transfer', 'storageTransfer']],
  ]);
  const FUTURE_OPTION = '書類作成';
  const CHIP_LABELS = [
    [/^翻訳:/, '高精度翻訳'],
    [/^Agent:/, 'Agent Mode'],
    [/^転送:/, '外部Storage転送'],
  ];

  let visibility = new Map(Array.from(CURRENT_OPTIONS.keys(), (name) => [name, true]));
  let queued = false;
  let preferenceRequest = null;

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const preferenceData = (payload) => {
    const root = record(payload);
    return record(root.preferences || root.data || root);
  };

  function setHidden(element, hidden) {
    if (!(element instanceof HTMLElement)) return;
    if (element.hidden !== hidden) element.hidden = hidden;
    element.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  }

  function optionVisible(label) {
    if (label === FUTURE_OPTION) return false;
    if (!visibility.has(label)) return true;
    return visibility.get(label) !== false;
  }

  function applyLegacyPickerVisibility() {
    document.querySelectorAll('.canon-picker:not(.canon-purpose-picker) .canon-switch-row').forEach((row) => {
      if (!(row instanceof HTMLElement)) return;
      const label = text(row.querySelector('.canon-switch-copy strong'));
      if (label === FUTURE_OPTION || visibility.has(label)) setHidden(row, !optionVisible(label));
    });
  }

  function applyNativePickerVisibility() {
    document.querySelectorAll('.native-picker[aria-label="追加・実行Option"] .native-picker-body > button').forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      const label = text(button.querySelector('span'));
      if (label === FUTURE_OPTION || visibility.has(label)) setHidden(button, !optionVisible(label));
    });
  }

  function cleanComposerToolbar() {
    document.querySelectorAll('.native-left-tools button').forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const label = button.getAttribute('aria-label') || '';
      const value = text(button);
      const remove = value === '/' || value === '@' || value === '全画面'
        || label === 'Purposeを選択' || label === '具体対象を選択';
      setHidden(button, remove);
    });
    document.querySelectorAll('.native-private-toggle').forEach((node) => setHidden(node, true));
  }

  function normalizeComposerChips() {
    document.querySelectorAll('.native-selected-chips, .native-message-chips').forEach((container) => {
      if (!(container instanceof HTMLElement)) return;
      let visibleCount = 0;
      container.querySelectorAll(':scope > span').forEach((chip) => {
        if (!(chip instanceof HTMLElement)) return;
        const original = text(chip);
        if (original.startsWith('/') || original === 'Private' || original.startsWith('書類:')) {
          setHidden(chip, true);
          return;
        }
        const replacement = CHIP_LABELS.find(([pattern]) => pattern.test(original));
        if (replacement && original !== replacement[1]) chip.textContent = replacement[1];
        setHidden(chip, false);
        visibleCount += 1;
      });
      setHidden(container, visibleCount === 0);
    });
  }

  function hideFutureOptionInSettings() {
    document.querySelectorAll('.settings-option-row').forEach((row) => {
      if (!(row instanceof HTMLElement)) return;
      if (text(row.querySelector('strong')) === FUTURE_OPTION) setHidden(row, true);
    });
    document.querySelectorAll('.exterior-canon-fact').forEach((fact) => {
      if (!(fact instanceof HTMLElement)) return;
      if (text(fact.querySelector('small')) === FUTURE_OPTION) setHidden(fact, true);
    });
  }

  function applySurface() {
    if (isComposerRoute) {
      applyLegacyPickerVisibility();
      applyNativePickerVisibility();
      cleanComposerToolbar();
      normalizeComposerChips();
    }
    if (isOptionSettingsRoute) hideFutureOptionInSettings();
  }

  async function refreshPreferences() {
    if (preferenceRequest) return preferenceRequest;
    preferenceRequest = (async () => {
      try {
        const response = await fetch('/api/preferences', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = preferenceData(await response.json());
        const next = new Map();
        CURRENT_OPTIONS.forEach((keys, name) => {
          const found = keys.find((key) => Object.prototype.hasOwnProperty.call(data, key));
          next.set(name, found ? data[found] !== false : true);
        });
        visibility = next;
      } catch {
        // Candidate visibility fails open; execution entitlement remains server-side.
      } finally {
        preferenceRequest = null;
        applySurface();
      }
    })();
    return preferenceRequest;
  }

  function openUnifiedOptionPicker() {
    const addButton = document.querySelector('.native-left-tools button[aria-label="Fileと実行Optionを追加"]');
    if (!(addButton instanceof HTMLButtonElement)) return;
    addButton.click();
    void refreshPreferences();
  }

  function isTriggerPosition(target) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    return start === end && (start === 0 || /\s/.test(target.value[start - 1] || ''));
  }

  function onComposerKeyDown(event) {
    if (!isComposerRoute || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== '/' && event.key !== '@') return;
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.getAttribute('aria-label') !== 'Astera入力') return;
    if (!isTriggerPosition(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openUnifiedOptionPicker();
  }

  function onComposerClick(event) {
    if (!isComposerRoute) return;
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.getAttribute('aria-label') === 'Fileと実行Optionを追加') void refreshPreferences();
  }

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applySurface();
    });
  };

  document.addEventListener('keydown', onComposerKeyDown, true);
  document.addEventListener('click', onComposerClick, true);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', () => void refreshPreferences());
  window.addEventListener('pageshow', () => void refreshPreferences());
  applySurface();
  void refreshPreferences();
})();
