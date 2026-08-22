(() => {
  'use strict';

  const DEFAULT_API = 'https://g-ace-astera-customerai.hf.space';
  const SESSION_KEY = 'astera.customer-ai.session-id';
  const MODE_KEY = 'astera.customer-ai.response-mode';
  const MODE_SOURCE_KEY = 'astera.customer-ai.mode-source';
  const RESPONSE_MODES = new Set(['general','operation','billing','technical','investor','support','trouble','auto']);
  const current = window.AsteraCustomerAI || {};
  const script = document.currentScript;
  const config = {
    apiBase: script?.dataset.apiBase || window.__ASTERA_CUSTOMER_AI_API_BASE__ || DEFAULT_API,
    source: script?.dataset.source || 'astera-app',
    locale: document.documentElement.lang?.toLowerCase().startsWith('en') ? 'en' : 'ja-JP',
    timeoutMs: 30000,
    ...current.config
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
    return RESPONSE_MODES.has(value) ? value : 'auto';
  }

  function currentModeSource() {
    const value = readStore(MODE_SOURCE_KEY, 'auto');
    return ['selected', 'auto', 'confirmed'].includes(value) ? value : 'auto';
  }

  function setMode(mode = 'auto', source) {
    const resolved = RESPONSE_MODES.has(mode) ? mode : 'auto';
    writeStore(MODE_KEY, resolved);
    writeStore(MODE_SOURCE_KEY, source || (resolved === 'auto' ? 'auto' : 'selected'));
    return resolved;
  }

  function apiBase() {
    return String(config.apiBase || DEFAULT_API).trim().replace(/\/$/, '');
  }

  async function jsonOrEmpty(response) {
    return response.json().catch(() => ({}));
  }

  async function request(path, options = {}) {
    const base = apiBase();
    if (!base) throw new Error('customer_ai_runtime_not_configured');
    const response = await fetch(`${base}${path}`, options);
    const payload = await jsonOrEmpty(response);
    if (!response.ok) {
      const error = new Error(String(payload.detail || payload.error || `http_${response.status}`));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function ask(message, options = {}) {
    const text = String(message || '').trim();
    if (!text) throw new Error('message_required');
    if (text.length > 12000) throw new Error('message_too_large');

    const ownController = options.signal ? null : new AbortController();
    const signal = options.signal || ownController.signal;
    const timeoutMs = Number(options.timeoutMs || config.timeoutMs || 30000);
    const timeout = ownController ? window.setTimeout(() => ownController.abort(), timeoutMs) : null;

    try {
      const payload = await request('/respond', {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        signal,
        body: JSON.stringify({
          message: text,
          source: options.source || config.source || 'astera-app',
          locale: options.locale || config.locale || 'ja-JP',
          session_id: options.sessionId || getSessionId(),
          message_id: options.messageId || randomId('message'),
          response_mode: options.responseMode || currentMode(),
          mode_source: options.modeSource || currentModeSource(),
          current_path: options.currentPath || location.pathname || '/'
        })
      });
      if (payload.session_id) writeStore(SESSION_KEY, String(payload.session_id));
      window.dispatchEvent(new CustomEvent('astera:customer-ai-result', { detail: payload }));
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('timeout');
        timeoutError.name = 'AbortError';
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  }

  async function deleteSession(sessionId = readStore(SESSION_KEY)) {
    removeStore(SESSION_KEY);
    if (!sessionId) return true;
    const payload = await request(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      mode: 'cors',
      credentials: 'omit',
      headers: { accept: 'application/json' }
    });
    return payload.ok === true;
  }

  function configure(next = {}) {
    Object.assign(config, next);
    api.config = { ...config };
    return api.config;
  }

  const api = Object.assign(current, {
    config: { ...config },
    configure,
    createId: randomId,
    getSessionId,
    getMode: currentMode,
    setMode,
    ask,
    send: ask,
    submit: ask,
    deleteSession
  });

  window.AsteraCustomerAI = api;
  window.dispatchEvent(new CustomEvent('astera:customer-ai-ready', { detail: api.config }));
})();
