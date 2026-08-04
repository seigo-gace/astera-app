(() => {
  'use strict';

  const ENHANCED_ATTRIBUTE = 'data-user-accordion';
  const COLLAPSED_ATTRIBUTE = 'data-user-collapsed';
  const COMPOSER_SELECTOR = '.composer textarea, .fullscreen-dialog textarea';
  const USER_MESSAGE_SELECTOR = '.user-message';
  const RUN_BUTTON_SELECTOR = '.run-button:not(.is-stop)';
  const PREVIEW_LIMIT = 96;
  const REQUIRED_RESULT_SECTION_COUNT = 8;
  const originalFetch = window.fetch.bind(window);
  let processInFlight = false;
  let launchLocked = false;

  function language() {
    return document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'ja';
  }

  function labels() {
    return language() === 'en'
      ? { expand: 'Show your message', collapse: 'Hide your message' }
      : { expand: '投稿内容を表示', collapse: '投稿内容を閉じる' };
  }

  function normalizePreview(value) {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= PREVIEW_LIMIT) return compact;
    return `${compact.slice(0, PREVIEW_LIMIT)}…`;
  }

  function updateTrigger(section, trigger, expanded) {
    const copy = labels();
    const preview = trigger.querySelector('.user-message-accordion-preview');
    const label = trigger.querySelector('.user-message-accordion-label');
    const icon = trigger.querySelector('.user-message-accordion-icon');

    section.setAttribute(COLLAPSED_ATTRIBUTE, expanded ? 'false' : 'true');
    trigger.setAttribute('aria-expanded', String(expanded));
    trigger.setAttribute('aria-label', expanded ? copy.collapse : copy.expand);
    if (label) label.textContent = expanded ? copy.collapse : copy.expand;
    if (preview instanceof HTMLElement) preview.hidden = expanded;
    if (icon) icon.textContent = expanded ? '⌃' : '⌄';
  }

  function enhanceUserMessage(section) {
    if (!(section instanceof HTMLElement) || section.hasAttribute(ENHANCED_ATTRIBUTE)) return;

    const paragraph = section.querySelector(':scope > p');
    if (!(paragraph instanceof HTMLParagraphElement)) return;

    const previewText = normalizePreview(paragraph.textContent || '');
    const copy = labels();
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'user-message-accordion-trigger';
    trigger.innerHTML = `
      <span class="user-message-accordion-copy">
        <span class="user-message-accordion-label">${copy.expand}</span>
        <span class="user-message-accordion-preview"></span>
      </span>
      <span class="user-message-accordion-icon" aria-hidden="true">⌄</span>`;

    const preview = trigger.querySelector('.user-message-accordion-preview');
    if (preview) preview.textContent = previewText;

    trigger.addEventListener('click', () => {
      const expanded = trigger.getAttribute('aria-expanded') !== 'true';
      updateTrigger(section, trigger, expanded);
    });

    section.setAttribute(ENHANCED_ATTRIBUTE, 'true');
    section.insertBefore(trigger, paragraph);
    updateTrigger(section, trigger, false);
  }

  function enhanceAllUserMessages(root = document) {
    root.querySelectorAll(USER_MESSAGE_SELECTOR).forEach(enhanceUserMessage);
  }

  function processRequestUrl(input) {
    try {
      const raw = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : '';
      if (!raw) return null;
      const url = new URL(raw, window.location.href);
      return url.pathname === '/process' || url.pathname.endsWith('/process') ? url : null;
    } catch {
      return null;
    }
  }

  function nonEmptyValue(value) {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return false;
  }

  function resultSectionCount(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
    const root = payload;
    const candidate = root.result && typeof root.result === 'object' && !Array.isArray(root.result)
      ? root.result
      : root;
    const sections = Array.isArray(root.sections)
      ? root.sections
      : Array.isArray(candidate.sections)
        ? candidate.sections
        : null;

    if (sections) {
      const keys = new Set();
      for (const [index, item] of sections.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const body = typeof item.body === 'string' ? item.body : item.content;
        if (!nonEmptyValue(body)) continue;
        keys.add(String(item.key ?? index));
      }
      return keys.size;
    }

    const aliases = [
      ['true_purpose', 'purpose'],
      ['missing_assumptions'],
      ['fact_check', 'facts'],
      ['risk_detection', 'risks'],
      ['counter_view', 'opposing_view'],
      ['alternatives', 'options'],
      ['recommendation'],
      ['next_prompt', 'instruction_for_primary_ai'],
    ];
    return aliases.filter((keys) => keys.some((key) => nonEmptyValue(candidate[key]))).length;
  }

  function processErrorResponse(code, message, status = 502) {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  window.fetch = async (input, init = {}) => {
    if (!processRequestUrl(input)) return originalFetch(input, init);
    if (processInFlight) {
      return processErrorResponse('ASTERA_PROCESS_ALREADY_RUNNING', '同じ画面で処理が進行中です。', 409);
    }

    processInFlight = true;
    launchLocked = true;
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const requestId = headers.get('Idempotency-Key') || crypto.randomUUID();
    headers.set('Idempotency-Key', requestId);
    headers.set('X-Request-ID', requestId);

    try {
      const response = await originalFetch(input, { ...init, headers });
      if (!response.ok) return response;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        return processErrorResponse('ASTERA_RESPONSE_JSON_REQUIRED', 'AsteraのResult形式を確認できませんでした。');
      }
      const payload = await response.clone().json().catch(() => null);
      const sectionCount = resultSectionCount(payload);
      if (sectionCount !== REQUIRED_RESULT_SECTION_COUNT) {
        return processErrorResponse(
          'ASTERA_RESPONSE_SECTIONS_INCOMPLETE',
          `AsteraのResultが固定8項目を満たしていません。受信項目数: ${sectionCount}`,
        );
      }
      return response;
    } finally {
      processInFlight = false;
      launchLocked = false;
    }
  };

  function handleRunActivation(event) {
    const target = event.target instanceof Element ? event.target.closest(RUN_BUTTON_SELECTOR) : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    if (processInFlight || launchLocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    launchLocked = true;
    queueMicrotask(() => {
      if (!processInFlight) launchLocked = false;
    });
  }

  function handleComposerKeydown(event) {
    if (event.key !== 'Enter') return;
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches(COMPOSER_SELECTOR)) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      const scope = event.target.closest('.composer-wrap, .fullscreen-dialog');
      const runButton = scope?.querySelector(`${RUN_BUTTON_SELECTOR}:not(:disabled)`);
      if (runButton instanceof HTMLButtonElement) runButton.click();
      return;
    }

    // Plain Enter and Shift+Enter remain line breaks. Capture-phase propagation
    // is stopped so React's legacy Enter-to-submit handler cannot run.
    event.stopPropagation();
  }

  let scheduled = false;
  function scheduleEnhancement() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      enhanceAllUserMessages();
    });
  }

  document.addEventListener('click', handleRunActivation, true);
  document.addEventListener('keydown', handleComposerKeydown, true);

  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['lang'],
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleEnhancement, { once: true });
  } else {
    scheduleEnhancement();
  }
})();
