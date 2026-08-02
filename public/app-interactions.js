(() => {
  'use strict';

  const ENHANCED_ATTRIBUTE = 'data-user-accordion';
  const COLLAPSED_ATTRIBUTE = 'data-user-collapsed';
  const COMPOSER_SELECTOR = '.composer textarea, .fullscreen-dialog textarea';
  const USER_MESSAGE_SELECTOR = '.user-message';
  const PREVIEW_LIMIT = 96;

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
  }

  function handleComposerKeydown(event) {
    if (event.key !== 'Enter') return;
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches(COMPOSER_SELECTOR)) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      const scope = event.target.closest('.composer-wrap, .fullscreen-dialog');
      const runButton = scope?.querySelector('.run-button:not(.is-stop):not(:disabled)');
      if (runButton instanceof HTMLButtonElement) runButton.click();
      return;
    }

    // Plain Enter and Shift+Enter are reserved for line breaks. Stopping propagation
    // prevents React's existing Enter-to-submit handler while preserving the textarea default.
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
