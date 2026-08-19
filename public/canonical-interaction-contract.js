(() => {
  'use strict';

  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  const IS_COMPOSER = ROUTE === '/app' || ROUTE === '/app/new';
  const SIMPLE_SETTINGS = new Map([
    ['/app/settings/options', 'options'],
    ['/app/settings/language', 'language'],
    ['/app/settings/notifications', 'notifications'],
  ]);
  const OPTION_COMMANDS = new Map([
    ['\u9ad8\u7cbe\u5ea6\u7ffb\u8a33', 'translation'],
    ['Agent Mode', 'agent-mode'],
    ['\u66f8\u985e\u4f5c\u6210', 'document'],
    ['\u5916\u90e8Storage\u8ee2\u9001', 'external-storage-transfer'],
  ]);

  let suppressComposerTrigger = false;
  let settingsRequestController = null;

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const create = (tag, className = '', value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const button = (label, className = '') => {
    const el = create('button', className, label);
    el.type = 'button';
    return el;
  };

  function setNativeValue(input, value) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function triggerAllowedAt(textarea) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    if (start !== end) return false;
    if (start === 0) return true;
    return /\s/.test(textarea.value[start - 1] || '');
  }

  function bindComposerKeyboardTriggers() {
    if (!IS_COMPOSER) return;
    const textarea = document.querySelector('.canonical-composer-card textarea');
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.dataset.canonTriggerBound === 'true') return;
    textarea.dataset.canonTriggerBound = 'true';
    textarea.addEventListener('keydown', (event) => {
      if (suppressComposerTrigger || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.key !== '@' && event.key !== '/') || !triggerAllowedAt(textarea)) return;
      const selector = event.key === '@' ? '.canon-at' : '.canon-plus';
      const trigger = document.querySelector(selector);
      if (!(trigger instanceof HTMLButtonElement) || trigger.disabled) return;
      event.preventDefault();
      suppressComposerTrigger = true;
      trigger.click();
      queueMicrotask(() => { suppressComposerTrigger = false; });
    });
  }

  function labelForOptionInput(input) {
    const label = input.closest('label');
    return text(label);
  }

  function selectedOptionInputs() {
    return Array.from(document.querySelectorAll('.canonical-option-grid input[type="checkbox"]:checked'))
      .filter((input) => input instanceof HTMLInputElement);
  }

  function fieldByLabel(labelText) {
    return Array.from(document.querySelectorAll('.canonical-option-section .canonical-field'))
      .find((row) => text(row).includes(labelText));
  }

  function commandProjection() {
    const commands = [];
    const purpose = document.querySelector('.canonical-purpose-grid input[type="radio"]:checked');
    if (purpose instanceof HTMLInputElement && purpose.value) commands.push(`/purpose ${purpose.value}`);

    selectedOptionInputs().forEach((input) => {
      const label = labelForOptionInput(input);
      const key = Array.from(OPTION_COMMANDS.entries()).find(([name]) => label.includes(name))?.[1];
      if (!key) return;
      if (key === 'agent-mode') {
        const mode = fieldByLabel('Agent\u5f37\u5ea6')?.querySelector('select');
        commands.push(`/option agent-mode ${mode instanceof HTMLSelectElement && mode.value ? mode.value : 'medium'}`);
        return;
      }
      if (key === 'document') {
        const template = fieldByLabel('\u66f8\u985eTemplate ID')?.querySelector('input');
        const id = template instanceof HTMLInputElement ? template.value.trim() : '';
        const source = template instanceof HTMLElement ? template.dataset.templateSource || '' : '';
        commands.push(`/option document${source ? ` ${source}` : ''}${id ? ` ${id}` : ''}`);
        return;
      }
      if (key === 'external-storage-transfer') {
        const destination = fieldByLabel('Storage Destination ID')?.querySelector('input');
        const id = destination instanceof HTMLInputElement ? destination.value.trim() : '';
        commands.push(`/option external-storage-transfer${id ? ` ${id}` : ''}`);
        return;
      }
      if (key === 'translation') {
        const target = fieldByLabel('\u7ffb\u8a33\u5148\u8a00\u8a9e')?.querySelector('input');
        const lang = target instanceof HTMLInputElement ? target.value.trim() : '';
        commands.push(`/option translation${lang ? ` ${lang}` : ''}`);
      }
    });
    return commands;
  }

  function refreshCommandProjection() {
    if (!IS_COMPOSER) return;
    const card = document.querySelector('.canonical-composer-card');
    if (!(card instanceof HTMLElement)) return;
    const commands = commandProjection();
    card.dataset.canonInternalCommands = JSON.stringify(commands);
    let hidden = card.querySelector('[data-canon-command-projection]');
    if (!(hidden instanceof HTMLInputElement)) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.dataset.canonCommandProjection = 'true';
      hidden.setAttribute('aria-hidden', 'true');
      card.append(hidden);
    }
    hidden.value = JSON.stringify(commands);
  }

  function bindProjectionEvents() {
    if (!IS_COMPOSER || document.documentElement.dataset.canonProjectionBound === 'true') return;
    document.documentElement.dataset.canonProjectionBound = 'true';
    document.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.canonical-purpose-grid,.canonical-option-grid,.canonical-option-section,.canonical-two-column')) refreshCommandProjection();
    });
    document.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.canonical-option-section,.canonical-two-column')) refreshCommandProjection();
    });
  }

  async function fetchJson(url, options = {}) {
    settingsRequestController?.abort();
    settingsRequestController = new AbortController();
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(options.headers || {}) },
      ...options,
      signal: settingsRequestController.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (response.status === 204) return {};
    return response.json();
  }

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function preferenceData(payload) {
    const root = record(payload);
    return record(root.preferences || root.data || root);
  }

  function settingRow(label, control, help = '') {
    const row = create('label', 'canon-inline-setting-row');
    const copy = create('span', 'canon-inline-setting-copy');
    copy.append(create('strong', '', label));
    if (help) copy.append(create('small', '', help));
    row.append(copy, control);
    return row;
  }

  function checkboxControl(checked = false, disabled = false) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    input.disabled = disabled;
    return input;
  }

  function selectControl(options, value = '') {
    const select = create('select', 'canon-inline-select');
    options.forEach(([optionValue, label]) => {
      const option = create('option', '', label);
      option.value = optionValue;
      select.append(option);
    });
    select.value = value || options[0]?.[0] || '';
    return select;
  }

  function inputControl(value = '', type = 'text') {
    const input = create('input', 'canon-inline-input');
    input.type = type;
    input.value = value ?? '';
    return input;
  }

  function statusHost() {
    const status = create('p', 'canon-inline-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    return status;
  }

  async function saveJson(endpoint, payload, status) {
    status.textContent = '\u4fdd\u5b58\u4e2d\u2026';
    try {
      await fetchJson(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      status.textContent = '\u4fdd\u5b58\u3057\u307e\u3057\u305f\u3002';
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      status.textContent = `\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002${error instanceof Error ? ` (${error.message})` : ''}`;
      return false;
    }
  }

  function dedicatedLinks() {
    const nav = create('div', 'canon-inline-dedicated-links');
    [
      ['/app/settings/templates', '\u500b\u5225Template\u7ba1\u7406'],
      ['/app/settings/storage-destinations', '\u5916\u90e8Storage\u63a5\u7d9a'],
      ['/app/settings/astera-storage', 'Astera Storage'],
    ].forEach(([href, label]) => {
      const link = create('a', 'canon-inline-link', label);
      link.href = href;
      nav.append(link);
    });
    return nav;
  }

  async function buildOptionsPane(body, status) {
    body.append(create('p', 'canon-inline-loading', '\u73fe\u5728\u8a2d\u5b9a\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u3059\u2026'));
    let data = {};
    try {
      data = preferenceData(await fetchJson('/api/preferences'));
    } catch (error) {
      if (error?.name !== 'AbortError') status.textContent = `\u73fe\u5728\u8a2d\u5b9a\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002${error instanceof Error ? ` (${error.message})` : ''}`;
    }
    body.replaceChildren();
    const fields = {
      translation: checkboxControl(data.translation !== false),
      agent_mode: checkboxControl(data.agent_mode !== false),
      document: checkboxControl(data.document !== false),
      storage_transfer: checkboxControl(data.storage_transfer !== false),
    };
    body.append(
      settingRow('\u9ad8\u7cbe\u5ea6\u7ffb\u8a33', fields.translation, '\uff0b\u306e\u5019\u88dc\u3078\u8868\u793a'),
      settingRow('Agent Mode', fields.agent_mode, '\uff0b\u306e\u5019\u88dc\u3078\u8868\u793a'),
      settingRow('\u66f8\u985e\u4f5c\u6210', fields.document, '\uff0b\u306e\u5019\u88dc\u3078\u8868\u793a'),
      settingRow('\u5916\u90e8Storage\u8ee2\u9001', fields.storage_transfer, '\uff0b\u306e\u5019\u88dc\u3078\u8868\u793a'),
    );
    const info = create('div', 'canon-inline-note');
    info.innerHTML = '<strong>Private Mode</strong><p>Composer\u3092\u958b\u304f\u305f\u3073\u65e2\u5b9aON\u3002\u6052\u4e45OFF\u8a2d\u5b9a\u306f\u6301\u305f\u305a\u3001\uff0b\u306e\u5b9f\u884cOption\u5019\u88dc\u306b\u3082\u542b\u3081\u307e\u305b\u3093\u3002</p>';
    body.append(info, dedicatedLinks());
    const save = button('\u4fdd\u5b58', 'canon-inline-primary');
    save.addEventListener('click', () => void saveJson('/api/preferences', {
      translation: fields.translation.checked,
      agent_mode: fields.agent_mode.checked,
      document: fields.document.checked,
      storage_transfer: fields.storage_transfer.checked,
    }, status));
    body.append(save);
  }

  async function buildLanguagePane(body, status) {
    body.append(create('p', 'canon-inline-loading', '\u73fe\u5728\u8a2d\u5b9a\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u3059\u2026'));
    let data = {};
    try {
      data = preferenceData(await fetchJson('/api/preferences'));
    } catch (error) {
      if (error?.name !== 'AbortError') status.textContent = `\u73fe\u5728\u8a2d\u5b9a\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002${error instanceof Error ? ` (${error.message})` : ''}`;
    }
    body.replaceChildren();
    const language = selectControl([['ja-JP','\u65e5\u672c\u8a9e'],['en-US','English']], String(data.ui_language || document.documentElement.lang || 'ja-JP'));
    const theme = selectControl([['system','System'],['light','Light'],['dark','Dark']], String(data.theme || 'system'));
    const evidence = selectControl([['standard','\u6a19\u6e96'],['compact','\u7c21\u6f54'],['expanded','\u8a73\u7d30']], String(data.evidence_display_mode || 'standard'));
    const motion = checkboxControl(Boolean(data.reduced_motion));
    body.append(
      settingRow('\u30b7\u30b9\u30c6\u30e0\u8a00\u8a9e', language),
      settingRow('Theme', theme),
      settingRow('\u6839\u62e0\u8868\u793a\u65b9\u5f0f', evidence),
      settingRow('Reduced Motion', motion),
    );
    const save = button('\u4fdd\u5b58', 'canon-inline-primary');
    save.addEventListener('click', () => void saveJson('/api/preferences', {
      ui_language: language.value,
      theme: theme.value,
      evidence_display_mode: evidence.value,
      reduced_motion: motion.checked,
    }, status));
    body.append(save);
  }

  async function buildNotificationsPane(body, status) {
    body.append(create('p', 'canon-inline-loading', '\u73fe\u5728\u8a2d\u5b9a\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u3059\u2026'));
    let data = {};
    try {
      data = preferenceData(await fetchJson('/api/credit/notification-preferences'));
    } catch (error) {
      if (error?.name !== 'AbortError') status.textContent = `\u73fe\u5728\u8a2d\u5b9a\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002${error instanceof Error ? ` (${error.message})` : ''}`;
    }
    body.replaceChildren();
    const inApp = checkboxControl(true, true);
    const email = checkboxControl(Boolean(data.email_enabled));
    const push = checkboxControl(Boolean(data.push_enabled));
    const threshold = inputControl(String(data.low_credit_threshold || '20'), 'number');
    threshold.min = '0';
    const quietStart = inputControl(String(data.quiet_hours_start || '22:00'), 'time');
    const quietEnd = inputControl(String(data.quiet_hours_end || '08:00'), 'time');
    body.append(
      settingRow('App\u5185\u5b89\u5168\u901a\u77e5', inApp, '\u5fc5\u9808'),
      settingRow('Email\u901a\u77e5', email),
      settingRow('Push\u901a\u77e5', push, '\u7aef\u672bPermission\u304c\u5fc5\u8981'),
      settingRow('Credit\u8b66\u544a\u95be\u5024', threshold),
      settingRow('Quiet Hours\u958b\u59cb', quietStart),
      settingRow('Quiet Hours\u7d42\u4e86', quietEnd),
    );
    const eventNote = create('div', 'canon-inline-note');
    eventNote.innerHTML = '<strong>\u5bfe\u8c61Event</strong><p>Low / Critical / Insufficient / Purchase Pending / Credited / Resume Available / Resume Blocked\u3002\u91cd\u8981\u306a\u5b89\u5168\u901a\u77e5\u306fApp\u5185\u901a\u77e5\u3092\u7dad\u6301\u3057\u307e\u3059\u3002</p>';
    body.append(eventNote);
    const save = button('\u4fdd\u5b58', 'canon-inline-primary');
    save.addEventListener('click', () => void saveJson('/api/credit/notification-preferences', {
      in_app_enabled: true,
      email_enabled: email.checked,
      push_enabled: push.checked,
      low_credit_threshold: threshold.value,
      quiet_hours_start: quietStart.value,
      quiet_hours_end: quietEnd.value,
    }, status));
    body.append(save);
  }

  async function openInlineSettings(panel, kind, title) {
    if (!(panel instanceof HTMLElement)) return;
    settingsRequestController?.abort();
    const nav = panel.querySelector('nav');
    const header = panel.querySelector('header');
    if (!(nav instanceof HTMLElement) || !(header instanceof HTMLElement)) return;
    panel.querySelector('[data-canon-inline-settings]')?.remove();
    nav.hidden = true;
    const pane = create('section', 'canon-inline-settings');
    pane.dataset.canonInlineSettings = kind;
    const paneHeader = create('div', 'canon-inline-settings-head');
    const back = button('\u2190', 'canon-inline-back');
    back.setAttribute('aria-label', 'Settings\u4e00\u89a7\u3078\u623b\u308b');
    const heading = create('div', '');
    heading.append(create('strong', '', title), create('small', '', 'Settings Overlay'));
    paneHeader.append(back, heading);
    const body = create('div', 'canon-inline-settings-body');
    const status = statusHost();
    pane.append(paneHeader, body, status);
    header.after(pane);
    back.addEventListener('click', () => {
      settingsRequestController?.abort();
      pane.remove();
      nav.hidden = false;
      nav.querySelector('a')?.focus();
    });
    if (kind === 'options') await buildOptionsPane(body, status);
    else if (kind === 'language') await buildLanguagePane(body, status);
    else if (kind === 'notifications') await buildNotificationsPane(body, status);
  }

  function enhanceSettingsOverlay() {
    const panel = document.querySelector('.exterior-settings-panel');
    if (!(panel instanceof HTMLElement) || panel.dataset.canonOverlayBoundary === 'true') return;
    panel.dataset.canonOverlayBoundary = 'true';
    panel.querySelectorAll('nav a[href]').forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const rawHref = link.getAttribute('href') || link.href || '';
      const pathname = rawHref.startsWith('/')
        ? rawHref.split(/[?#]/, 1)[0]
        : (() => { try { return new URL(rawHref, window.location.href).pathname; } catch { return ''; } })();
      const kind = SIMPLE_SETTINGS.get(pathname);
      if (kind) {
        link.dataset.canonSettingsMode = 'overlay';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          void openInlineSettings(panel, kind, text(link).replace('\u203a', '').trim());
        });
      } else {
        link.dataset.canonSettingsMode = 'page';
      }
    });
  }

  function run() {
    bindComposerKeyboardTriggers();
    bindProjectionEvents();
    refreshCommandProjection();
    enhanceSettingsOverlay();
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      run();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
