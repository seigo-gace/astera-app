(() => {
  'use strict';

  const guardedFetch = window.fetch.bind(window);

  function isProcessRequest(input) {
    try {
      const raw = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : '';
      if (!raw) return false;
      const url = new URL(raw, window.location.href);
      return url.pathname === '/process' || url.pathname.endsWith('/process');
    } catch {
      return false;
    }
  }

  function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function firstText(record, keys) {
    if (!record) return '';
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  async function actionableError(response) {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('json')) {
      return new Error(`Asteraの実行に失敗しました。HTTP ${response.status}`);
    }
    const payload = await response.clone().json().catch(() => null);
    const root = asRecord(payload);
    const nested = asRecord(root?.error) ?? root;
    const code = firstText(nested, ['code', 'error_code', 'type']) || `HTTP_${response.status}`;
    const message = firstText(nested, ['message', 'detail', 'title']) || 'Asteraの実行に失敗しました。';
    const error = new Error(`${message} [${code}]`);
    error.name = 'AsteraProcessError';
    return error;
  }

  window.fetch = async (input, init) => {
    const response = await guardedFetch(input, init);
    if (!isProcessRequest(input) || response.ok) return response;
    throw await actionableError(response);
  };
})();
