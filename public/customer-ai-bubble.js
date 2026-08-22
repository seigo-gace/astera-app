(() => {
  'use strict';

  const transport = window.AsteraCustomerAI;
  if (!transport || document.getElementById('astera-customer-ai')) return;

  const HISTORY_KEY = 'astera.customer-ai.history-v2';
  const MAX_HISTORY_ITEMS = 20;

  const root = document.createElement('section');
  root.id = 'astera-customer-ai';
  root.className = 'aca-shell';
  root.setAttribute('aria-label', 'Astera 総合案内AI');
  root.innerHTML = `
    <div class="aca-panel" id="aca-panel" aria-hidden="true">
      <header class="aca-header">
        <div><small>ASTERA CUSTOMER AI</small><strong>総合案内AI</strong></div>
        <button class="aca-minimize" type="button" aria-label="最小化">−</button>
      </header>
      <div class="aca-status"><i></i><span>製品・利用方法・料金・技術・支援について案内します</span></div>
      <div class="aca-log" role="log" aria-live="polite" aria-relevant="additions">
        <div class="aca-message aca-bot" data-ai-welcome>Asteraについて知りたいことを入力してください。追加質問も同じ会話のまま続けられます。</div>
      </div>
      <form class="aca-form">
        <textarea class="aca-input" rows="1" maxlength="12000" placeholder="質問を入力" aria-label="総合案内AIへの質問"></textarea>
        <button class="aca-send" type="submit">送信</button>
      </form>
      <p class="aca-note">回答は承認済みKBと現在の実装情報を基に生成します。</p>
    </div>`;
  document.body.appendChild(root);

  const panel = root.querySelector('.aca-panel');
  const minimize = root.querySelector('.aca-minimize');
  const form = root.querySelector('.aca-form');
  const input = root.querySelector('.aca-input');
  const send = root.querySelector('.aca-send');
  const log = root.querySelector('.aca-log');
  const welcome = root.querySelector('[data-ai-welcome]');
  let sending = false;
  let activeController = null;
  let conversationEpoch = 0;

  function readStore(key, fallback = '') {
    try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }

  function writeStore(key, value) {
    try { sessionStorage.setItem(key, value); } catch {}
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(124, Math.max(44, input.scrollHeight))}px`;
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
      case 'timeout':
      case 'customer_ai_timeout': return '回答に時間がかかっています。入力内容を保持したまま再試行できます。';
      case 'Failed to fetch': return '案内AIへ接続できません。少し時間を空けて再試行してください。';
      default: return '案内AIで一時的なエラーが発生しました。入力内容を保持したまま再試行できます。';
    }
  }

  function open() {
    root.classList.add('aca-open');
    panel.setAttribute('aria-hidden', 'false');
  }

  function close() {
    root.classList.remove('aca-open');
    panel.setAttribute('aria-hidden', 'true');
    input.blur?.();
  }

  function append(text, role, pending = false) {
    welcome?.remove();
    const item = document.createElement('div');
    item.className = `aca-message aca-${role}${pending ? ' aca-pending' : ''}`;
    item.dataset.aiMessageRole = role === 'user' ? 'user' : 'assistant';
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function update(item, text, role = 'bot') {
    if (!item) return;
    item.className = `aca-message aca-${role}`;
    item.dataset.aiMessageRole = role === 'user' ? 'user' : 'assistant';
    item.textContent = text;
    log.scrollTop = log.scrollHeight;
  }

  function persistHistory() {
    const history = [...log.querySelectorAll('.aca-message[data-ai-message-role]')]
      .slice(-MAX_HISTORY_ITEMS)
      .map((item) => ({
        role: item.dataset.aiMessageRole === 'user' ? 'user' : 'assistant',
        text: String(item.textContent || '').slice(0, 8000),
        state: item.classList.contains('aca-error') ? 'error' : 'completed'
      }))
      .filter((item) => item.text);
    writeStore(HISTORY_KEY, JSON.stringify(history));
  }

  function restoreHistory() {
    let history = [];
    try { history = JSON.parse(readStore(HISTORY_KEY, '[]')); } catch {}
    if (!Array.isArray(history) || history.length === 0) return;
    welcome?.remove();
    for (const entry of history.slice(-MAX_HISTORY_ITEMS)) {
      if (!entry || !['user', 'assistant'].includes(entry.role) || !String(entry.text || '').trim()) continue;
      const item = append(String(entry.text), entry.role === 'user' ? 'user' : 'bot');
      if (entry.state === 'error') item.classList.add('aca-error');
    }
  }

  function answerText(result) {
    if (result?.answer) return String(result.answer);
    if (result?.status === 'awaiting_clarification') {
      return String(result.clarification || '回答に必要な条件が不足しています。確認したい内容を教えてください。');
    }
    if (result?.status === 'failed') return '処理を完了できませんでした。少し時間を置いて、同じ質問をもう一度送ってください。';
    return '回答を準備しましたが、表示できる本文がありません。';
  }

  async function submit() {
    if (sending) return;
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }

    const epoch = conversationEpoch;
    sending = true;
    send.disabled = true;
    input.disabled = true;
    append(text, 'user');
    input.value = '';
    resizeInput();
    const pending = append('回答中…', 'bot', true);
    persistHistory();

    const controller = new AbortController();
    activeController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const result = await transport.ask(text, {
        signal: controller.signal,
        source: 'astera-app',
        locale: document.documentElement.lang?.toLowerCase().startsWith('en') ? 'en' : 'ja-JP',
        currentPath: location.pathname
      });
      if (epoch !== conversationEpoch) return;
      const answer = answerText(result).trim();
      if (!answer) throw new Error('empty_answer');
      update(pending, answer, result?.status === 'failed' ? 'error' : 'bot');
      persistHistory();
    } catch (error) {
      if (epoch !== conversationEpoch) return;
      const code = error?.name === 'AbortError' ? 'timeout' : String(error?.message || 'internal_error');
      update(pending, errorMessage(code), 'error');
      pending.classList.add('aca-error');
      input.value = text;
      resizeInput();
      persistHistory();
    } finally {
      window.clearTimeout(timeout);
      if (activeController === controller) activeController = null;
      if (epoch === conversationEpoch) {
        sending = false;
        send.disabled = false;
        input.disabled = false;
        input.focus();
      }
    }
  }

  restoreHistory();
  resizeInput();
  bindReliableControl(minimize, close);

  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.classList.contains('aca-open')) close();
  });

  window.AsteraCustomerAIUI = Object.assign(window.AsteraCustomerAIUI || {}, { open, close, root });
})();
