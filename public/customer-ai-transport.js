(() => {
  'use strict';

  const current = window.AsteraCustomerAI || {};
  const script = document.currentScript;
  const config = {
    apiBase: script?.dataset.apiBase || window.__ASTERA_CUSTOMER_AI_API_BASE__ || 'https://g-ace-astera-customerai.hf.space',
    source: script?.dataset.source || 'astera-app',
    locale: document.documentElement.lang || 'ja-JP',
    responseMode: 'auto',
    modeSource: 'auto',
    timeoutMs: 30000,
    ...current.config
  };

  const cleanBase = () => String(config.apiBase || '').trim().replace(/\/$/, '');
  const createId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
  const sessionKey = `astera.customer-ai.session.${config.source}`;

  function readSession() {
    try { return sessionStorage.getItem(sessionKey) || ''; } catch { return ''; }
  }

  function writeSession(value) {
    try { sessionStorage.setItem(sessionKey, value); } catch {}
  }

  function removeSession() {
    try { sessionStorage.removeItem(sessionKey); } catch {}
  }

  function getSessionId() {
    let value = readSession();
    if (!value || !/^session_[A-Za-z0-9_.:]{4,}$/.test(value)) {
      value = createId('session');
      writeSession(value);
    }
    return value;
  }

  async function request(path, options = {}) {
    const base = cleanBase();
    if (!base) throw new Error('customer_ai_runtime_not_configured');
    const response = await fetch(`${base}${path}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(payload.detail || payload.error || `customer_ai_http_${response.status}`));
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

    const sessionId = options.sessionId || getSessionId();
    const messageId = options.messageId || createId('message');
    const ownController = options.signal ? null : new AbortController();
    const signal = options.signal || ownController.signal;
    const timeoutMs = Number(options.timeoutMs || config.timeoutMs);
    const timeout = ownController ? setTimeout(() => ownController.abort(), timeoutMs) : null;

    try {
      const payload = await request('/respond', {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        signal,
        body: JSON.stringify({
          message: text,
          source: options.source || config.source,
          locale: options.locale || config.locale,
          session_id: sessionId,
          message_id: messageId,
          response_mode: options.responseMode || config.responseMode,
          mode_source: options.modeSource || config.modeSource,
          current_path: options.currentPath || location.pathname || '/'
        })
      });
      if (payload.session_id) writeSession(String(payload.session_id));
      window.dispatchEvent(new CustomEvent('astera:customer-ai-result', { detail: payload }));
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('customer_ai_timeout');
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function deleteSession(sessionId = readSession()) {
    removeSession();
    if (!sessionId) return { ok: true, deleted: false };
    try {
      return await request(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        mode: 'cors',
        credentials: 'omit',
        headers: { accept: 'application/json' }
      });
    } catch {
      return { ok: true, deleted: false };
    }
  }

  function configure(next = {}) {
    Object.assign(config, next);
    api.config = { ...config };
    return api.config;
  }

  const api = Object.assign(current, {
    config: { ...config },
    configure,
    createId,
    getSessionId,
    ask,
    send: ask,
    submit: ask,
    deleteSession
  });

  window.AsteraCustomerAI = api;
  window.dispatchEvent(new CustomEvent('astera:customer-ai-ready', { detail: api.config }));
})();
