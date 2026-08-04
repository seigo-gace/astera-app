(() => {
  'use strict';

  const PURPOSE_OPTION_SELECTOR = '.option-grid:not(.paid-option-grid) .option-card';
  const PROJECT_SOURCE_MARKER = 'data-project-source-unavailable';
  const SETTINGS_MARKER = 'data-session-settings-notice';
  let scheduled = false;

  function handlePurposeSelection(event) {
    const target = event.target instanceof Element ? event.target.closest(PURPOSE_OPTION_SELECTOR) : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled || target.classList.contains('is-selected')) return;
    const grid = target.closest('.option-grid');
    if (!grid) return;
    grid.querySelectorAll('.option-card.is-selected').forEach((selected) => {
      if (selected instanceof HTMLButtonElement && selected !== target) selected.click();
    });
  }

  function markUnavailableProjectSources(root) {
    root.querySelectorAll('.dialog-content').forEach((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.hasAttribute(PROJECT_SOURCE_MARKER)) return;
      const list = dialog.querySelector('.template-list');
      const notice = dialog.querySelector('.dialog-notice');
      if (!list || !notice) return;
      const buttons = [...list.querySelectorAll('.template-card')];
      if (buttons.length !== 3) return;

      dialog.setAttribute(PROJECT_SOURCE_MARKER, 'true');
      buttons.forEach((button) => {
        if (!(button instanceof HTMLButtonElement)) return;
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.title = 'Project Source接続はBackend実装前です。';
      });
      notice.textContent = 'Project Source接続は未実装です。押しても動かない状態にはせず、接続完了まで選択を停止しています。';
      notice.setAttribute('role', 'status');
    });
  }

  function annotateSessionSettings(root) {
    root.querySelectorAll('.dialog-content').forEach((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.hasAttribute(SETTINGS_MARKER)) return;
      if (!dialog.querySelector('.settings-section')) return;
      const notice = dialog.querySelector('.dialog-notice');
      if (!notice) return;

      dialog.setAttribute(SETTINGS_MARKER, 'true');
      notice.textContent = 'このDialogの変更は現在の表示Sessionだけに反映されます。Accountへ保存する設定はSettings Pageで行ってください。';
      notice.setAttribute('role', 'status');
      const action = document.createElement('a');
      action.href = '/app/settings';
      action.className = 'secondary-button session-settings-link';
      action.textContent = 'Settings Pageを開く';
      notice.insertAdjacentElement('afterend', action);
    });
  }

  function enhance(root = document) {
    markUnavailableProjectSources(root);
    annotateSessionSettings(root);
  }

  function scheduleEnhancement() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  document.addEventListener('click', handlePurposeSelection, true);
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.documentElement, { subtree: true, childList: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleEnhancement, { once: true });
  } else {
    scheduleEnhancement();
  }
})();
