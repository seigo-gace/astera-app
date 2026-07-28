(() => {
  'use strict';

  const transport = window.AsteraCustomerAI;
  if (!transport || document.getElementById('astera-customer-ai')) return;

  const root = document.createElement('section');
  root.id = 'astera-customer-ai';
  root.className = 'aca-shell';
  root.setAttribute('aria-label', 'Astera 総合案内AI');
  root.innerHTML = `
    <button class="aca-launcher" type="button" aria-expanded="false" aria-controls="aca-panel" title="総合案内AIを開く">
      <span class="aca-orbit" aria-hidden="true"></span>
      <span class="aca-mark" aria-hidden="true">✦</span>
      <span class="aca-launcher-label">案内AI</span>
    </button>
    <div class="aca-panel" id="aca-panel" aria-hidden="true">
      <header class="aca-header">
        <div><small>ASTERA CUSTOMER AI</small><strong>総合案内AI</strong></div>
        <button class="aca-minimize" type="button" aria-label="最小化">−</button>
      </header>
      <div class="aca-status"><i></i><span>製品・利用方法・料金・技術・支援について案内します</span></div>
      <div class="aca-log" role="log" aria-live="polite" aria-relevant="additions">
        <div class="aca-message aca-bot">Asteraについて知りたいことを入力してください。追加質問も同じ会話のまま続けられます。</div>
      </div>
      <form class="aca-form">
        <textarea class="aca-input" rows="1" maxlength="20000" placeholder="質問を入力" aria-label="総合案内AIへの質問"></textarea>
        <button class="aca-send" type="submit">送信</button>
      </form>
      <p class="aca-note">回答は承認済みKBと現在の実装情報を基に生成します。</p>
    </div>`;
  document.body.appendChild(root);

  const launcher = root.querySelector('.aca-launcher');
  const panel = root.querySelector('.aca-panel');
  const minimize = root.querySelector('.aca-minimize');
  const form = root.querySelector('.aca-form');
  const input = root.querySelector('.aca-input');
  const send = root.querySelector('.aca-send');
  const log = root.querySelector('.aca-log');
  let busy = false;

  function open() {
    root.classList.add('aca-open');
    launcher.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 80);
  }

  function close() {
    root.classList.remove('aca-open');
    launcher.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
  }

  function append(text, role, pending = false) {
    const item = document.createElement('div');
    item.className = `aca-message aca-${role}${pending ? ' aca-pending' : ''}`;
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function answerText(result) {
    if (result.answer) return String(result.answer);
    if (result.status === 'awaiting_clarification') {
      return String(result.clarification || '回答に必要な条件が不足しています。確認したい内容を教えてください。');
    }
    if (result.status === 'failed') return '処理を完了できませんでした。少し時間を置いて、同じ質問をもう一度送ってください。';
    return '回答を準備しましたが、表示できる本文がありません。';
  }

  launcher.addEventListener('click', () => root.classList.contains('aca-open') ? close() : open());
  minimize.addEventListener('click', close);

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 124)}px`;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    input.disabled = true;
    append(text, 'user');
    input.value = '';
    input.style.height = 'auto';
    const pending = append('確認して回答を組み立てています…', 'bot', true);
    try {
      const result = await transport.ask(text);
      pending.remove();
      append(answerText(result), 'bot');
    } catch (error) {
      pending.remove();
      const message = error?.message === 'customer_ai_poll_timeout'
        ? '処理が続いています。時間を置いてから、もう一度お試しください。'
        : '現在、総合案内AIへ接続できません。接続設定または稼働状況を確認してください。';
      append(message, 'bot');
    } finally {
      busy = false;
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });

  // Dragging is limited to the collapsed launcher so text selection and mobile
  // scrolling inside the expanded panel remain unaffected.
  let drag = null;
  launcher.addEventListener('pointerdown', (event) => {
    if (root.classList.contains('aca-open')) return;
    drag = { x: event.clientX, y: event.clientY, right: parseFloat(getComputedStyle(root).right), bottom: parseFloat(getComputedStyle(root).bottom), moved: false };
    launcher.setPointerCapture(event.pointerId);
  });
  launcher.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    root.style.right = `${Math.max(10, Math.min(innerWidth - 72, drag.right - dx))}px`;
    root.style.bottom = `${Math.max(10, Math.min(innerHeight - 72, drag.bottom - dy))}px`;
  });
  launcher.addEventListener('pointerup', (event) => {
    if (drag?.moved) event.preventDefault();
    drag = null;
  });

  window.AsteraCustomerAIUI = Object.assign(window.AsteraCustomerAIUI || {}, { open, close, root });
})();
