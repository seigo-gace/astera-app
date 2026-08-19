(() => {
  'use strict';

  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  const IS_COMPOSER = ROUTE === '/app' || ROUTE === '/app/new';
  const PURPOSE_LABELS = new Map([
    ['auto', '自動'], ['review', 'レビュー'], ['compare', '比較'], ['verify', '検証'],
    ['improve', '改善'], ['research', '調査'], ['plan', '計画'], ['consider', '検討'],
  ]);
  let purposeBackdrop = null;
  let purposePanel = null;
  let scheduled = false;

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const create = (tag, cls = '', value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const button = (label, cls = '') => {
    const el = create('button', cls, label);
    el.type = 'button';
    return el;
  };

  function purposeInputs() {
    return Array.from(document.querySelectorAll('.canonical-purpose-grid input[type="radio"]'))
      .filter((input) => input instanceof HTMLInputElement);
  }

  function purposeLabel(input) {
    return PURPOSE_LABELS.get(input.value) || text(input.closest('label')?.querySelector('strong')) || input.value;
  }

  function closePurpose() {
    purposeBackdrop?.remove();
    purposePanel?.remove();
    purposeBackdrop = null;
    purposePanel = null;
  }

  function refreshPurposeChip() {
    if (!IS_COMPOSER) return;
    const host = document.querySelector('[data-exterior-chips]');
    if (!(host instanceof HTMLElement)) return;
    const selected = purposeInputs().find((input) => input.checked);
    let chip = host.querySelector('[data-canon-purpose-chip]');
    if (!(chip instanceof HTMLElement)) {
      chip = create('span', 'canon-purpose-chip');
      chip.dataset.canonPurposeChip = 'true';
      host.prepend(chip);
    }
    const nextText = `/${selected ? purposeLabel(selected) : '自動'}`;
    if (chip.textContent !== nextText) chip.textContent = nextText;
  }

  function openPurposePicker() {
    closePurpose();
    purposeBackdrop = button('', 'canon-picker-backdrop canon-purpose-backdrop');
    purposeBackdrop.setAttribute('aria-label', 'Purpose選択を閉じる');
    purposeBackdrop.addEventListener('click', closePurpose);
    purposePanel = create('section', 'canon-picker canon-purpose-picker');
    purposePanel.setAttribute('role', 'dialog');
    purposePanel.setAttribute('aria-modal', 'true');
    purposePanel.setAttribute('aria-label', 'Purposeを選択');
    const head = create('header', 'canon-picker-head');
    const close = button('×', 'canon-picker-close');
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', closePurpose);
    head.append(create('strong', '', '/ Purpose'), close);
    const body = create('div', 'canon-picker-body');
    purposeInputs().forEach((input) => {
      const item = button(`/${purposeLabel(input)}`, input.checked ? 'canon-list-button is-selected' : 'canon-list-button');
      item.addEventListener('click', () => {
        input.click();
        refreshPurposeChip();
        closePurpose();
      });
      body.append(item);
    });
    purposePanel.append(head, body);
    document.body.append(purposeBackdrop, purposePanel);
    queueMicrotask(() => purposePanel?.querySelector('button')?.focus());
  }

  function triggerAllowedAt(textarea) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    if (start !== end) return false;
    return start === 0 || /\s/.test(textarea.value[start - 1] || '');
  }

  function bindSlash() {
    if (!IS_COMPOSER || document.documentElement.dataset.canonPurposeSlashBound === 'true') return;
    document.documentElement.dataset.canonPurposeSlashBound = 'true';
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.closest('.canonical-composer-card')) return;
      if (event.key !== '/' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !triggerAllowedAt(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openPurposePicker();
    }, true);
  }

  function setNativeValue(input, value) {
    if (!(input instanceof HTMLInputElement)) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyTranslationDefault() {
    if (!IS_COMPOSER) return;
    const translation = Array.from(document.querySelectorAll('.canonical-option-grid label'))
      .find((row) => text(row).includes('高精度翻訳'))?.querySelector('input[type="checkbox"]');
    if (!(translation instanceof HTMLInputElement) || !translation.checked) return;
    const field = Array.from(document.querySelectorAll('.canonical-option-section .canonical-field'))
      .find((row) => text(row).includes('翻訳先言語'));
    const input = field?.querySelector('input');
    if (input instanceof HTMLInputElement && !input.value.trim()) {
      setNativeValue(input, document.documentElement.lang || navigator.language || 'ja-JP');
    }
  }

  function vaultCard() {
    const card = create('section', 'canon-vault-settings-card');
    card.dataset.canonVaultSettings = 'true';
    const head = create('div', 'canon-vault-settings-head');
    head.append(create('strong', '', '暗号化・鍵管理（Libral Vault）'), create('span', 'canon-vault-always-on', '常時保護'));
    const description = create('p', '', '暗号化をOFFにするToggleは設けません。Vault API本体は既存のLibral Vaultを使用します。');
    const grid = create('div', 'canon-vault-settings-grid');
    [
      ['HTTPS / TLS', '常時有効'],
      ['内部Secret保護', 'Libral Vault'],
      ['暗号化追加Credit', '0'],
      ['利用者管理鍵', '設定状態・変更導線・復旧不能警告'],
    ].forEach(([label, value]) => {
      const item = create('div', 'canon-vault-setting');
      item.append(create('small', '', label), create('strong', '', value));
      grid.append(item);
    });
    card.append(head, description, grid);
    return card;
  }

  function ensureVaultSettings() {
    const inline = document.querySelector('[data-canon-inline-settings="options"] .canon-inline-settings-body');
    if (inline instanceof HTMLElement && !inline.querySelector('[data-canon-vault-settings]')) inline.append(vaultCard());
    if (ROUTE === '/app/settings/options') {
      const host = document.querySelector('.platform-page-content') || document.querySelector('.platform-main') || document.querySelector('main');
      if (host instanceof HTMLElement && !host.querySelector('[data-canon-vault-settings]')) host.append(vaultCard());
    }
  }

  function run() {
    bindSlash();
    refreshPurposeChip();
    applyTranslationDefault();
    ensureVaultSettings();
  }

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      run();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
