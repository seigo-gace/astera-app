(() => {
  'use strict';

  const current = window.AsteraCustomerAI || {};
  const script = document.currentScript;
  const config = {
    apiBase: script?.dataset.apiBase || window.__ASTERA_CUSTOMER_AI_API_BASE__ || 'https://api.asterav8.jp',
    source: script?.dataset.source || 'astera-app',
    locale: document.documentElement.lang || 'ja-JP',
    pollIntervalMs: 1600,
    maxPolls: 120,
    ...current.config
  };

  const cleanBase = () => String(config.apiBase || '').replace(/\/$/, '');
  const createId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
  const sessionKey = `astera.customer-ai.session.${config.source}`;

  function getSessionId() {
    let value = localStorage.getItem(sessionKey);
    if (!value || !/^session_[A-Za-z0-9_.:]{4,}$/.test(value)) {
      value = createId('session');
      localStorage.setItem(sessionKey, value);
    }
    return value;
  }

  async function turnstileToken() {
    if (typeof current.getTurnstileToken === 'function') return current.getTurnstileToken();
    if (window.AsteraTurnstile && typeof window.AsteraTurnstile.getToken === 'function') {
      return window.AsteraTurnstile.getToken();
    }
    return '';
  }

  async function request(path, options = {}) {
    const response = await fetch(`${cleanBase()}${path}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      const error = new Error(payload.error || `customer_ai_http_${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return { response, payload };
  }

  async function send(message, options = {}) {
    const text = String(message || '').trim();
    if (!text) throw new Error('message_required');
    const sessionId = options.sessionId || getSessionId();
    const messageId = options.messageId || createId('message');
    const jobId = options.jobId || createId('job');
    const token = options.turnstileToken ?? await turnstileToken();
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-turnstile-token'] = token;
    const { payload } = await request('/v1/customer-ai/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: text,
        session_id: sessionId,
        message_id: messageId,
        job_id: jobId,
        locale: options.locale || config.locale,
        source: options.source || config.source
      })
    });
    window.dispatchEvent(new CustomEvent('astera:customer-ai-accepted', { detail: payload }));
    return payload;
  }

  async function poll(jobId) {
    const { response, payload } = await request(`/v1/customer-ai/jobs/${encodeURIComponent(jobId)}`);
    return { ...payload, pending: response.status === 202 };
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function ask(message, options = {}) {
    const accepted = await send(message, options);
    const maxPolls = Number(options.maxPolls || config.maxPolls);
    const pollIntervalMs = Number(options.pollIntervalMs || config.pollIntervalMs);
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await delay(pollIntervalMs);
      const result = await poll(accepted.job_id);
      window.dispatchEvent(new CustomEvent('astera:customer-ai-progress', { detail: result }));
      if (!result.pending && ['completed', 'awaiting_clarification', 'degraded', 'failed'].includes(result.status)) {
        window.dispatchEvent(new CustomEvent('astera:customer-ai-result', { detail: result }));
        return result;
      }
    }
    throw new Error('customer_ai_poll_timeout');
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
    send,
    submit: send,
    poll,
    getJob: poll,
    ask
  });

  window.AsteraCustomerAI = api;
  window.dispatchEvent(new CustomEvent('astera:customer-ai-ready', { detail: api.config }));
})();
