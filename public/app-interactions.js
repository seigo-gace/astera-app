(() => {
  'use strict';

  const ENHANCED_ATTRIBUTE = 'data-user-accordion';
  const COLLAPSED_ATTRIBUTE = 'data-user-collapsed';
  const COMPOSER_SELECTOR = '.composer textarea, .fullscreen-dialog textarea';
  const USER_MESSAGE_SELECTOR = '.user-message';
  const RUN_BUTTON_SELECTOR = '.run-button:not(.is-stop)';
  const PREVIEW_LIMIT = 96;
  const MAX_INPUT_CHARACTERS = 200_000;
  const CANONICAL_RESULT_SECTION_KEYS = [
    'true_purpose',
    'missing_assumptions',
    'fact_check',
    'risk_detection',
    'counter_view',
    'alternatives',
    'recommendation',
    'next_prompt',
  ];
  const REQUIRED_RESULT_SECTION_COUNT = CANONICAL_RESULT_SECTION_KEYS.length;
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
    root.querySelectorAll(COMPOSER_SELECTOR).forEach((textarea) => {
      if (textarea instanceof HTMLTextAreaElement) textarea.maxLength = MAX_INPUT_CHARACTERS;
    });
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

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function nonEmptyValue(value) {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return false;
  }

  async function processRequestPayload(input, init) {
    const body = init.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof body !== 'string' || !body.trim()) return null;
    try {
      const payload = JSON.parse(body);
      return isRecord(payload) ? payload : null;
    } catch {
      return null;
    }
  }

  function processRequestError(payload) {
    if (!payload) {
      return { code: 'ASTERA_PROCESS_PAYLOAD_INVALID', message: '実行Requestの形式を確認できません。', status: 422 };
    }
    if (typeof payload.input !== 'string' || !payload.input.trim()) {
      return { code: 'ASTERA_INPUT_REQUIRED', message: '実行する本文がありません。', status: 422 };
    }
    if ([...payload.input].length > MAX_INPUT_CHARACTERS) {
      return {
        code: 'ASTERA_INPUT_TOO_LARGE',
        message: `入力は${MAX_INPUT_CHARACTERS.toLocaleString()}文字以内にしてください。`,
        status: 413,
      };
    }
    const files = Array.isArray(payload.files) ? payload.files : [];
    const unresolvedFile = files.find((file) => {
      if (!isRecord(file)) return true;
      return !['upload_id', 'object_id', 'storage_reference'].some((key) => typeof file[key] === 'string' && file[key].trim());
    });
    if (unresolvedFile) {
      return {
        code: 'FILE_UPLOAD_PIPELINE_NOT_CONNECTED',
        message: '添付Fileの実DataがUploadされていないため、内容を解析したように見せず安全停止しました。',
        status: 409,
      };
    }
    return null;
  }

  function sectionBody(section) {
    if (!isRecord(section)) return '';
    if (typeof section.body === 'string') return section.body.trim();
    if (typeof section.content === 'string') return section.content.trim();
    return '';
  }

  function canonicalSectionsFromObject(value) {
    if (!isRecord(value)) return null;
    const sections = [];
    for (const key of CANONICAL_RESULT_SECTION_KEYS) {
      const source = value[key];
      const body = sectionBody(source);
      if (!body) return null;
      sections.push({
        key,
        title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : key.replace(/_/g, ' '),
        body,
        sourceIds: Array.isArray(source.sourceIds) ? source.sourceIds : Array.isArray(source.source_ids) ? source.source_ids : [],
      });
    }
    return sections;
  }

  function normalizeProcessPayload(payload) {
    if (!isRecord(payload)) return { payload, sectionCount: 0, changed: false };
    const result = isRecord(payload.result) ? payload.result : null;
    const candidate = result ?? payload;
    const sectionValue = candidate.sections ?? payload.sections;

    if (Array.isArray(sectionValue)) {
      const keys = new Set();
      const normalized = [];
      for (const [index, item] of sectionValue.entries()) {
        const body = sectionBody(item);
        if (!body) continue;
        const key = String(isRecord(item) && item.key != null ? item.key : index);
        if (keys.has(key)) continue;
        keys.add(key);
        normalized.push({
          ...(isRecord(item) ? item : {}),
          key,
          title: isRecord(item) && typeof item.title === 'string' ? item.title : `Section ${index + 1}`,
          body,
        });
      }
      return { payload, sectionCount: normalized.length, changed: false };
    }

    const canonical = canonicalSectionsFromObject(sectionValue);
    if (canonical) {
      if (result) {
        return {
          payload: { ...payload, result: { ...result, sections: canonical }, sections: canonical },
          sectionCount: canonical.length,
          changed: true,
        };
      }
      return {
        payload: { ...payload, sections: canonical },
        sectionCount: canonical.length,
        changed: true,
      };
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
    const sectionCount = aliases.filter((keys) => keys.some((key) => nonEmptyValue(candidate[key]))).length;
    return { payload, sectionCount, changed: false };
  }

  function processErrorResponse(code, message, status = 502) {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  function normalizedJsonResponse(response, payload) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.delete('content-length');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers,
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
      const requestPayload = await processRequestPayload(input, init);
      const requestError = processRequestError(requestPayload);
      if (requestError) return processErrorResponse(requestError.code, requestError.message, requestError.status);

      const response = await originalFetch(input, { ...init, headers });
      if (!response.ok) return response;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('json')) {
        return processErrorResponse('ASTERA_RESPONSE_JSON_REQUIRED', 'AsteraのResult形式を確認できませんでした。');
      }
      const payload = await response.clone().json().catch(() => null);
      const normalized = normalizeProcessPayload(payload);
      if (normalized.sectionCount !== REQUIRED_RESULT_SECTION_COUNT) {
        return processErrorResponse(
          'ASTERA_RESPONSE_SECTIONS_INCOMPLETE',
          `AsteraのResultが固定8項目を満たしていません。受信項目数: ${normalized.sectionCount}`,
        );
      }
      return normalized.changed ? normalizedJsonResponse(response, normalized.payload) : response;
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
