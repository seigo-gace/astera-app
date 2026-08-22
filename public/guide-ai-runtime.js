(() => {
  'use strict';

  const PANEL_ID = 'ai-chat';
  const DEFAULT_API = 'https://g-ace-astera-customerai.hf.space';
  const SESSION_KEY = 'astera.customer-ai.session-id';
  const MODE_KEY = 'astera.customer-ai.response-mode';
  const MODE_SOURCE_KEY = 'astera.customer-ai.mode-source';
  const HISTORY_KEY = 'astera.customer-ai.history-v2';
  const MAX_HISTORY_ITEMS = 20;
  const RESPONSE_MODES = {
    general: 'Asteraについて',
    operation: '操作・使い方',
    billing: '料金・Account',
    technical: '技術者向け',
    investor: '投資家・法人向け',
    support: '開発支援・Sponsor',
    trouble: '不具合・困りごと',
    auto: 'AIに任せる'
  };

  const script = document.currentScript;
  const config = {
    apiBase: script?.dataset.apiBase || window.__ASTERA_CUSTOMER_AI_API_BASE__ || DEFAULT_API,
    source: script?.dataset.source || 'astera-app',
    timeoutMs: 30000
  };

  function randomId(prefix) {
    const value = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID().replaceAll('-', '')
      : `${Date.now()}${Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9]/g, '');
    return `${prefix}_${value}`;
  }

  function readStore(key, fallback = '') {
    try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  function writeStore(key, value) {
    try { sessionStorage.setItem(key, value); } catch {}
  }

  function removeStore(key) {
    try { sessionStorage.removeItem(key); } catch {}
  }

  function getSessionId() {
    const existing = readStore(SESSION_KEY);
    if (existing) return existing;
    const created = randomId('session');
    writeStore(SESSION_KEY, created);
    return created;
  }

  function currentMode() {
    const value = readStore(MODE_KEY, 'auto');
    return Object.hasOwn(RESPONSE_MODES, value) ? value : 'auto';
  }

  function currentModeSource() {
    const value = readStore(MODE_SOURCE_KEY, 'auto');
    return ['selected', 'auto', 'confirmed'].includes(value) ? value : 'auto';
  }

  function storeMode(mode) {
    writeStore(MODE_KEY, mode);
    writeStore(MODE_SOURCE_KEY, mode === 'auto' ? 'auto' : 'selected');
  }

  function apiBase(panel) {
    return String(panel?.dataset.customerAiApi || config.apiBase || DEFAULT_API).trim().replace(/\/$/, '');
  }

  function setEmptyState(empty, hidden) {
    if (empty) empty.hidden = hidden;
  }

  function createMessage(timeline, empty, role, text, state = '') {
    setEmptyState(empty, true);
    const item = document.createElement('div');
    item.className = `ai-message ai-message--${state || role}`;
    item.dataset.aiMessageRole = role;
    const label = document.createElement('strong');
    label.className = 'ai-message__label';
    label.textContent = role === 'user' ? 'あなた' : 'Astera AI';
    const body = document.createElement('p');
    body.className = 'ai-message__body';
    body.textContent = text;
    item.append(label, body);
    timeline.append(item);
    timeline.scrollTop = timeline.scrollHeight;
    return item;
  }

  function updateMessage(item, text, state = 'assistant') {
    if (!item) return;
    item.className = `ai-message ai-message--${state}`;
    const body = item.querySelector('.ai-message__body');
    if (body) body.textContent = text;
    item.parentElement?.scrollTo({ top: item.parentElement.scrollHeight, behavior: 'smooth' });
  }

  function persistHistory(timeline) {
    const history = [...timeline.querySelectorAll('.ai-message')]
      .slice(-MAX_HISTORY_ITEMS)
      .map((item) => ({
        role: item.dataset.aiMessageRole === 'user' ? 'user' : 'assistant',
        text: item.querySelector('.ai-message__body')?.textContent?.slice(0, 8000) || '',
        state: item.classList.contains('ai-message--error') ? 'error' : 'completed'
      }))
      .filter((item) => item.text);
    writeStore(HISTORY_KEY, JSON.stringify(history));
  }

  function restoreHistory(timeline, empty) {
    let history = [];
    try { history = JSON.parse(readStore(HISTORY_KEY, '[]')); } catch {}
    if (!Array.isArray(history)) return;
    for (const entry of history.slice(-MAX_HISTORY_ITEMS)) {
      if (!entry || !['user', 'assistant'].includes(entry.role) || !String(entry.text || '').trim()) continue;
      createMessage(timeline, empty, entry.role, String(entry.text), entry.state === 'error' ? 'error' : '');
    }
  }

  function resizeInput(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(120, Math.max(44, textarea.scrollHeight))}px`;
  }

  function bindReliableControl(element, handler) {
    if (!element) return;
    let lastTouchActivation = 0;
    element.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      lastTouchActivation = Date.now();
      handler(event);
    });
    element.addEventListener('click', (event) => {
      if (Date.now() - lastTouchActivation < 700 && event.detail !== 0) {
        event.preventDefault();
        return;
      }
      handler(event);
    });
  }

  function errorMessage(code) {
    switch (code) {
      case 'rate_limited': return 'アクセスが集中しています。少し時間を空けてからもう一度お試しください。';
      case 'message_too_large': return '質問が長すぎます。内容を分けて送信してください。';
      case 'customer_ai_runtime_not_configured': return '案内AIは現在接続準備中です。';
      case 'runtime_accept_failed':
      case 'runtime_process_failed':
      case 'runtime_process_invalid':
      case 'runtime_session_delete_failed': return '案内AIへ接続できませんでした。入力内容を保持したまま再試行できます。';
      case 'timeout': return '回答に時間がかかっています。入力内容を保持したまま再試行できます。';
      case 'Failed to fetch': return '案内AIへ接続できません。少し時間を空けて再試行してください。';
      default: return '案内AIで一時的なエラーが発生しました。入力内容を保持したまま再試行できます。';
    }
  }

  async function jsonOrEmpty(response) {
    return response.json().catch(() => ({}));
  }

  async function respond(panel, message, signal) {
    const base = apiBase(panel);
    if (!base) throw new Error('customer_ai_runtime_not_configured');
    const response = await fetch(`${base}/respond`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      signal,
      body: JSON.stringify({
        message,
        source: config.source,
        locale: document.documentElement.lang?.toLowerCase().startsWith('en') ? 'en' : 'ja-JP',
        session_id: getSessionId(),
        message_id: randomId('message'),
        response_mode: currentMode(),
        mode_source: currentModeSource(),
        current_path: location.pathname
      })
    });
    const payload = await jsonOrEmpty(response);
    if (!response.ok) throw new Error(String(payload.detail || payload.error || `http_${response.status}`));
    if (payload.session_id) writeStore(SESSION_KEY, String(payload.session_id));
    window.dispatchEvent(new CustomEvent('astera:customer-ai-result', { detail: payload }));
    return payload;
  }

  async function deleteSession(panel, sessionId) {
    if (!sessionId) return true;
    const base = apiBase(panel);
    if (!base) return true;
    const response = await fetch(`${base}/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      mode: 'cors',
      credentials: 'omit',
      headers: { accept: 'application/json' }
    });
    const payload = await jsonOrEmpty(response);
    if (!response.ok) throw new Error(String(payload.detail || payload.error || `http_${response.status}`));
    return payload.ok === true;
  }

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'ai-chat ai-chat--glass';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'ai-chat-title');
    panel.innerHTML = `
      <div class="ai-chat__top-dock" data-ai-top-dock>
        <div class="ai-chat__header">
          <div class="ai-chat__title-wrap"><span class="ai-chat__connection" data-ai-connection aria-hidden="true"></span><h2 id="ai-chat-title">Astera総合案内AI</h2></div>
          <div class="ai-chat__window-actions">
            <button class="ai-window-button" type="button" data-ai-minimize aria-label="案内AIを最小化">－</button>
            <button class="ai-window-button ai-window-button--close" type="button" data-ai-delete-close aria-label="会話を削除して案内AIを閉じる">×</button>
          </div>
        </div>
        <div class="ai-routing" data-ai-routing>
          <div class="ai-routing__current">
            <label class="ai-mode-select-wrap">
              <span class="ai-mode-select-label">回答タイプ</span>
              <span class="ai-mode-select-shell">
                <select class="ai-mode-select" data-ai-mode-select aria-label="回答タイプ">
                  <option value="auto" selected>AIに任せる</option>
                  <option value="general">Asteraについて</option>
                  <option value="operation">操作・使い方</option>
                  <option value="billing">料金・Account</option>
                  <option value="technical">技術者向け</option>
                  <option value="investor">投資家・法人向け</option>
                  <option value="support">開発支援・Sponsor</option>
                  <option value="trouble">不具合・困りごと</option>
                </select>
                <span class="ai-mode-select-arrow" aria-hidden="true">⌄</span>
              </span>
            </label>
            <div class="ai-routing__actions"><button type="button" data-ai-new-chat>新しい会話</button></div>
          </div>
        </div>
      </div>
      <div class="ai-timeline" data-ai-timeline role="log" aria-live="polite" aria-label="案内AIとの会話">
        <div class="ai-chat__empty" data-ai-empty>Asteraについて質問してください。</div>
      </div>
      <div class="ai-chat__composer-dock" data-ai-composer-dock>
        <div class="ai-composer">
          <textarea data-ai-input aria-label="質問" placeholder="質問を入力…" rows="1" maxlength="12000"></textarea>
          <button class="ai-send" type="button" data-icon-send aria-label="送信"><svg class="ai-send__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6l.8 6.5L15 12 4.2 13.9z"/></svg></button>
        </div>
        <p class="ai-status" data-ai-status role="status" aria-live="polite"></p>
      </div>`;
    document.body.appendChild(panel);
  }

  if (panel.dataset.aiInitialized === 'true') return;

  const minimize = panel.querySelector('[data-ai-minimize]');
  const deleteClose = panel.querySelector('[data-ai-delete-close]');
  const newChat = panel.querySelector('[data-ai-new-chat]');
  const modeSelect = panel.querySelector('[data-ai-mode-select]');
  const modeChange = panel.querySelector('[data-ai-mode-change]');
  const modePicker = panel.querySelector('[data-ai-mode-picker]');
  const modeLabel = panel.querySelector('[data-ai-mode-label]');
  const modeButtons = [...panel.querySelectorAll('[data-ai-mode]')];
  const topDock = panel.querySelector('[data-ai-top-dock]');
  const composerDock = panel.querySelector('[data-ai-composer-dock]');
  const timeline = panel.querySelector('[data-ai-timeline]');
  const empty = panel.querySelector('[data-ai-empty]');
  const textarea = panel.querySelector('[data-ai-input]');
  const sendButton = panel.querySelector('.ai-send');
  const status = panel.querySelector('[data-ai-status]');
  const connection = panel.querySelector('[data-ai-connection]');
  const hasNewModeUi = Boolean(modeSelect);
  const hasLegacyModeUi = Boolean(modeChange && modePicker && modeLabel && modeButtons.length);
  if (!minimize || !deleteClose || !newChat || (!hasNewModeUi && !hasLegacyModeUi) || !timeline || !textarea || !sendButton || !status) return;

  panel.dataset.aiInitialized = 'true';

  let sending = false;
  let activeController = null;
  let conversationEpoch = 0;
  restoreHistory(timeline, empty);

  const renderMode = (showPicker = false) => {
    const mode = currentMode();
    if (modeSelect) modeSelect.value = mode;
    if (modeLabel) modeLabel.textContent = RESPONSE_MODES[mode];
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.aiMode === mode));
    if (modePicker) modePicker.hidden = !showPicker;
  };
  const hasRestoredConversation = timeline.querySelectorAll('.ai-message').length > 0;
  renderMode(!readStore(MODE_KEY) && !hasRestoredConversation);

  const setCssVar = (name, value) => panel.style?.setProperty?.(name, value);
  const removeCssVar = (name) => panel.style?.removeProperty?.(name);
  const measuredHeight = (element, fallback) => {
    const value = element?.getBoundingClientRect?.().height;
    return Number.isFinite(value) && value > 0 ? Math.ceil(value) : fallback;
  };
  const syncLayout = () => {
    if (panel.hidden || panel.classList.contains('is-minimized') || !panel.classList.contains('ai-chat--glass')) {
      removeCssVar('--ai-viewport-top');
      removeCssVar('--ai-viewport-height');
      return;
    }
    const viewport = window.visualViewport;
    if (viewport) {
      setCssVar('--ai-viewport-top', `${Math.max(0, Math.round(viewport.offsetTop || 0))}px`);
      setCssVar('--ai-viewport-height', `${Math.max(240, Math.round(viewport.height || window.innerHeight || 0))}px`);
    }
    setCssVar('--ai-top-dock-space', `${measuredHeight(topDock, 118)}px`);
    setCssVar('--ai-bottom-dock-space', `${measuredHeight(composerDock, 86)}px`);
  };

  const setOpenerExpanded = (open) => {
    document.querySelectorAll('.platform-header-ai').forEach((opener) => opener.setAttribute('aria-expanded', String(open)));
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    if (!open) {
      panel.classList.remove('is-minimized');
      textarea.blur?.();
    }
    setOpenerExpanded(open);
    window.setTimeout(syncLayout, 0);
  };

  const clearLocalConversation = () => {
    timeline.querySelectorAll('.ai-message').forEach((item) => item.remove());
    setEmptyState(empty, false);
    removeStore(SESSION_KEY);
    removeStore(HISTORY_KEY);
    storeMode('auto');
    renderMode(true);
    textarea.value = '';
    resizeInput(textarea);
    syncLayout();
  };

  const resetConversation = (keepOpen) => {
    const oldSession = readStore(SESSION_KEY);
    conversationEpoch += 1;
    activeController?.abort();
    activeController = null;
    sending = false;
    sendButton.disabled = false;
    textarea.disabled = false;
    connection?.classList.remove('is-working');
    textarea.blur?.();
    clearLocalConversation();
    status.textContent = '';
    setOpen(keepOpen);
    if (oldSession) deleteSession(panel, oldSession).catch(() => {});
  };

  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      const mode = modeSelect.value;
      if (!Object.hasOwn(RESPONSE_MODES, mode)) return;
      storeMode(mode);
      renderMode(false);
      status.textContent = '';
      syncLayout();
    });
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.aiMode;
      if (!Object.hasOwn(RESPONSE_MODES, mode)) return;
      storeMode(mode);
      renderMode(false);
      textarea.focus();
    });
  }

  bindReliableControl(modeChange, () => renderMode(true));
  bindReliableControl(newChat, () => resetConversation(true));
  bindReliableControl(deleteClose, () => resetConversation(false));
  bindReliableControl(minimize, () => {
    panel.classList.toggle('is-minimized');
    const minimized = panel.classList.contains('is-minimized');
    minimize.textContent = minimized ? '□' : '－';
    minimize.setAttribute('aria-label', minimized ? '案内AIを展開' : '案内AIを最小化');
    if (minimized) textarea.blur?.();
    window.setTimeout(syncLayout, 0);
  });

  async function send() {
    if (sending) return;
    const message = textarea.value.trim();
    if (!message) {
      status.textContent = '質問を入力してください。';
      textarea.focus();
      return;
    }

    renderMode(false);
    const epoch = conversationEpoch;
    sending = true;
    sendButton.disabled = true;
    textarea.disabled = true;
    connection?.classList.add('is-working');
    status.textContent = '';
    createMessage(timeline, empty, 'user', message);
    textarea.value = '';
    resizeInput(textarea);
    syncLayout();
    const pending = createMessage(timeline, empty, 'assistant', '回答中…', 'pending');
    persistHistory(timeline);

    const controller = new AbortController();
    activeController = controller;
    const timeout = window.setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const payload = await respond(panel, message, controller.signal);
      if (epoch !== conversationEpoch) return;
      const answer = String(payload.answer || payload.clarification || '').trim();
      if (!answer) throw new Error('empty_answer');
      updateMessage(pending, answer, payload.status === 'failed' ? 'error' : 'assistant');
      status.textContent = payload.status === 'awaiting_clarification' ? '追加情報を確認しています。' : '';
      persistHistory(timeline);
    } catch (error) {
      if (epoch !== conversationEpoch) return;
      const code = error?.name === 'AbortError' ? 'timeout' : String(error?.message || 'internal_error');
      updateMessage(pending, errorMessage(code), 'error');
      textarea.value = message;
      resizeInput(textarea);
      persistHistory(timeline);
    } finally {
      window.clearTimeout(timeout);
      if (activeController === controller) activeController = null;
      if (epoch === conversationEpoch) {
        sending = false;
        sendButton.disabled = false;
        textarea.disabled = false;
        connection?.classList.remove('is-working');
        syncLayout();
        textarea.focus();
      }
    }
  }

  const toggleFromOpener = () => {
    if (panel.hidden) return setOpen(true);
    if (panel.classList.contains('is-minimized')) {
      panel.classList.remove('is-minimized');
      minimize.textContent = '－';
      minimize.setAttribute('aria-label', '案内AIを最小化');
      setOpenerExpanded(true);
      window.setTimeout(syncLayout, 0);
      return;
    }
    setOpen(false);
  };

  sendButton.addEventListener('click', send);
  textarea.addEventListener('input', () => {
    resizeInput(textarea);
    syncLayout();
  });
  textarea.addEventListener('focus', syncLayout);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      send();
    }
  });
  window.visualViewport?.addEventListener('resize', syncLayout);
  window.visualViewport?.addEventListener('scroll', syncLayout);
  window.addEventListener?.('orientationchange', () => window.setTimeout(syncLayout, 0));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  setOpenerExpanded(false);
  resizeInput(textarea);

  window.AsteraCustomerAI = {
    config: { ...config },
    createId: randomId,
    getSessionId,
    ask: (message, options = {}) => respond(panel, String(message || '').trim(), options.signal),
    send: (message, options = {}) => respond(panel, String(message || '').trim(), options.signal),
    submit: (message, options = {}) => respond(panel, String(message || '').trim(), options.signal),
    deleteSession: (sessionId = readStore(SESSION_KEY)) => deleteSession(panel, sessionId)
  };
  window.AsteraCustomerAIUI = {
    open: toggleFromOpener,
    show: () => setOpen(true),
    close: () => setOpen(false),
    toggle: toggleFromOpener,
    root: panel
  };
  window.dispatchEvent(new CustomEvent('astera:customer-ai-ready', { detail: { ...config } }));
})();
