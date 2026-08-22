(() => {
  'use strict';

  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  const isComposer = ROUTE === '/app' || ROUTE === '/app/new';
  let picker = null;
  let mobileMenuReturnFocus = null;
  let mobileMenuWasOpen = false;

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const button = (label, className = '') => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = label;
    return el;
  };

  const focusableElements = (root) => Array.from(root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter((node) => {
      if (!(node instanceof HTMLElement) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function ensureCanonicalExteriorStyle() {
    if (document.querySelector('[data-exterior-canonical-style]')) return;
    const style = document.createElement('style');
    style.dataset.exteriorCanonicalStyle = 'true';
    style.textContent = `
html.exterior-settings-open{overflow:hidden!important}
html.exterior-mobile-menu-open{overflow:hidden!important}
@media(max-width:600px){
  .exterior-settings-panel{
    inset:0!important;top:0!important;left:0!important;right:0!important;bottom:0!important;
    width:100%!important;height:100dvh!important;max-height:none!important;transform:none!important;
    border:0!important;border-radius:0!important;padding-top:env(safe-area-inset-top)!important;
    padding-bottom:env(safe-area-inset-bottom)!important;display:flex!important;flex-direction:column!important;
  }
  .exterior-settings-panel header{flex:none}
  .exterior-settings-panel nav{flex:1;min-height:0;overflow:auto;padding:8px 8px calc(16px + env(safe-area-inset-bottom))!important}
  .exterior-settings-panel nav a{min-height:52px!important;border-radius:10px!important}
}`;
    document.head.append(style);
  }

  function enhanceMobileNavigation() {
    ensureCanonicalExteriorStyle();
    const drawer = document.querySelector('#platform-mobile-drawer');
    const menuButton = document.querySelector('.platform-menu-button');
    const isMobile = window.matchMedia('(max-width:760px)').matches;
    document.documentElement.classList.toggle('exterior-mobile-menu-open', isMobile && drawer instanceof HTMLElement);

    if (!(drawer instanceof HTMLElement)) {
      if (mobileMenuWasOpen) {
        mobileMenuWasOpen = false;
        const target = mobileMenuReturnFocus;
        mobileMenuReturnFocus = null;
        if (target?.isConnected) target.focus();
      }
      return;
    }

    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Navigation');
    if (drawer.dataset.exteriorMobileNavBound === 'true') return;
    drawer.dataset.exteriorMobileNavBound = 'true';
    mobileMenuWasOpen = true;
    mobileMenuReturnFocus = menuButton instanceof HTMLElement ? menuButton : null;

    drawer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const backdrop = document.querySelector('.platform-backdrop');
        if (backdrop instanceof HTMLButtonElement) backdrop.click();
        else if (menuButton instanceof HTMLButtonElement) menuButton.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(drawer);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    window.requestAnimationFrame(() => focusableElements(drawer)[0]?.focus());
  }

  function enhanceDesktopCollapse() {
    const sidebar = document.querySelector('.platform-sidebar');
    if (!sidebar || sidebar.querySelector('[data-exterior-collapse]')) return;
    const toggle = button('‹', 'exterior-sidebar-collapse');
    toggle.dataset.exteriorCollapse = 'true';
    toggle.setAttribute('aria-label', 'Sidebarを縮小');
    toggle.addEventListener('click', () => {
      const shell = document.querySelector('.platform-shell');
      const collapsed = shell?.classList.toggle('exterior-sidebar-collapsed') || false;
      toggle.textContent = collapsed ? '›' : '‹';
      toggle.setAttribute('aria-label', collapsed ? 'Sidebarを開く' : 'Sidebarを縮小');
    });
    sidebar.querySelector('.platform-brand')?.after(toggle);
  }

  function existingFileInput() {
    return document.querySelector('.canonical-files input[type="file"]');
  }

  function handoffFiles(files) {
    const input = existingFileInput();
    if (!(input instanceof HTMLInputElement) || !files?.length) return;
    try {
      const transfer = new DataTransfer();
      Array.from(files).forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      input.click();
    }
  }

  function closePicker() {
    picker?.remove();
    picker = null;
    document.querySelector('.exterior-picker-backdrop')?.remove();
  }

  function pickerFrame(title) {
    closePicker();
    const backdrop = button('', 'exterior-picker-backdrop');
    backdrop.setAttribute('aria-label', '選択を閉じる');
    backdrop.addEventListener('click', closePicker);
    const panel = document.createElement('section');
    panel.className = 'exterior-picker';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `<header><strong>${title}</strong><button type="button" aria-label="閉じる">×</button></header><div class="exterior-picker-body"></div>`;
    panel.querySelector('header button')?.addEventListener('click', closePicker);
    document.body.append(backdrop, panel);
    picker = panel;
    return panel.querySelector('.exterior-picker-body');
  }

  function openPurpose() {
    const body = pickerFrame('Purpose');
    document.querySelectorAll('.canonical-purpose-grid label').forEach((label) => {
      const input = label.querySelector('input[type="radio"]');
      if (!(input instanceof HTMLInputElement)) return;
      const item = button(text(label), input.checked ? 'is-selected' : '');
      item.addEventListener('click', () => { input.click(); closePicker(); refreshChips(); });
      body?.append(item);
    });
  }

  function openOptions() {
    const body = pickerFrame('実行Option');
    document.querySelectorAll('.canonical-option-grid label').forEach((label) => {
      const input = label.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) return;
      const item = button(text(label), input.checked ? 'is-selected' : '');
      item.disabled = input.disabled;
      item.addEventListener('click', () => { input.click(); item.classList.toggle('is-selected', input.checked); refreshChips(); });
      body?.append(item);
    });
  }

  function openProject() {
    const body = pickerFrame('Project');
    const current = document.querySelector('.canonical-two-column input');
    const wrap = document.createElement('div');
    wrap.className = 'exterior-project-picker';
    const input = document.createElement('input');
    input.placeholder = 'Project ID（任意）';
    input.value = current instanceof HTMLInputElement ? current.value : '';
    const done = button('完了');
    done.addEventListener('click', () => {
      if (current instanceof HTMLInputElement) setNativeValue(current, input.value);
      closePicker(); refreshChips();
    });
    const list = document.createElement('a');
    list.href = '/app/projects'; list.textContent = 'Project一覧を開く';
    wrap.append(input, list, done); body?.append(wrap); input.focus();
  }

  function openAdd() {
    const body = pickerFrame('追加');
    const entries = [
      ['＋', 'Fileを追加', () => { closePicker(); existingFileInput()?.click(); }],
      ['◉', 'Purpose', openPurpose],
      ['✦', '実行Option', openOptions],
      ['@', 'Project', openProject],
      ['◇', 'Private Mode', () => { const input = document.querySelector('.canonical-private-toggle input'); if (input instanceof HTMLInputElement && !input.disabled) input.click(); closePicker(); refreshChips(); }],
      ['↗', '全画面', () => { const target = Array.from(document.querySelectorAll('.canonical-composer-toolbar button')).find((el) => text(el).includes('全画面')); if (target instanceof HTMLButtonElement) target.click(); closePicker(); }],
    ];
    entries.forEach(([icon, label, action]) => {
      const item = button(''); item.innerHTML = `<span>${icon}</span><strong>${label}</strong>`; item.addEventListener('click', action); body?.append(item);
    });
  }

  function refreshChips() {
    const host = document.querySelector('[data-exterior-chips]');
    if (!host) return;

    const purposeInput = document.querySelector('.canonical-purpose-grid input:checked');
    const optionInputs = Array.from(document.querySelectorAll('.canonical-option-grid input:checked'));
    const projectInput = document.querySelector('.canonical-two-column input');
    const privateStateInput = document.querySelector('.canonical-private-toggle input');
    const signature = JSON.stringify({
      purpose: purposeInput instanceof HTMLInputElement ? purposeInput.value : '',
      options: optionInputs.map((input) => text(input.closest('label'))),
      project: projectInput instanceof HTMLInputElement ? projectInput.value.trim() : '',
      privateMode: privateStateInput instanceof HTMLInputElement && privateStateInput.checked,
    });
    if (host.dataset.exteriorChipsSignature === signature) return;
    host.dataset.exteriorChipsSignature = signature;
    host.replaceChildren();

    const checkedPurpose = purposeInput?.closest('label');
    if (checkedPurpose) {
      const purposeLabel = text(checkedPurpose).split(' ')[0];
      const chip = button(`◉ ${purposeLabel}`);
      chip.setAttribute('aria-label', `Purpose ${purposeLabel}を変更`);
      chip.addEventListener('click', openPurpose);
      host.append(chip);
    }

    document.querySelectorAll('.canonical-option-grid input:checked').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const label = input.closest('label');
      if (!label) return;
      const optionLabel = text(label);
      const chip = button(`✦ ${optionLabel} ×`);
      chip.setAttribute('aria-label', `${optionLabel} を解除`);
      chip.addEventListener('click', () => {
        if (!input.disabled && input.checked) input.click();
        refreshChips();
      });
      host.append(chip);
    });

    const project = document.querySelector('.canonical-two-column input');
    if (project instanceof HTMLInputElement && project.value.trim()) {
      const value = project.value.trim();
      const chip = button(`@ ${value} ×`);
      chip.setAttribute('aria-label', `Project ${value} を解除`);
      chip.addEventListener('click', () => {
        setNativeValue(project, '');
        refreshChips();
      });
      host.append(chip);
    }

    const privateInput = document.querySelector('.canonical-private-toggle input');
    if (privateInput instanceof HTMLInputElement && privateInput.checked) {
      const chip = button('◇ Private ×');
      chip.setAttribute('aria-label', 'Private Modeを解除');
      chip.addEventListener('click', () => {
        if (!privateInput.disabled && privateInput.checked) input.click();
        refreshChips();
      });
      host.append(chip);
    }
  }

  function enhanceComposer() {
    if (!isComposer) {
      document.documentElement.classList.remove('exterior-composer-route');
      return;
    }
    const card = document.querySelector('.canonical-composer-card');
    const textarea = card?.querySelector('textarea');
    if (!(card instanceof HTMLElement) || !(textarea instanceof HTMLTextAreaElement)) {
      document.documentElement.classList.remove('exterior-composer-route');
      return;
    }
    document.documentElement.classList.add('exterior-composer-route');
    if (!card.querySelector('[data-exterior-tools]')) {
      const tools = document.createElement('div');
      tools.className = 'exterior-composer-tools'; tools.dataset.exteriorTools = 'true';
      const add = button('＋', 'exterior-round-tool'); add.setAttribute('aria-label', '追加'); add.addEventListener('click', openAdd);
      const project = button('@', 'exterior-round-tool'); project.setAttribute('aria-label', 'Project'); project.addEventListener('click', openProject);
      const chips = document.createElement('div'); chips.className = 'exterior-chips'; chips.dataset.exteriorChips = 'true';
      tools.append(add, project, chips);
      textarea.closest('.canonical-field')?.before(tools);
      refreshChips();
    }
    if (textarea.dataset.exteriorBound !== 'true') {
      textarea.dataset.exteriorBound = 'true';
      textarea.addEventListener('paste', (event) => { const files = event.clipboardData?.files; if (files?.length) handoffFiles(files); }, { passive: true });
      card.addEventListener('dragover', (event) => event.preventDefault());
      card.addEventListener('drop', (event) => { event.preventDefault(); handoffFiles(event.dataTransfer?.files); });
    }
  }

  function refresh() {
    document.documentElement.dataset.asteraExterior = 'gpt';
    ensureCanonicalExteriorStyle();
    enhanceMobileNavigation();
    enhanceDesktopCollapse();
    enhanceComposer();
    refreshChips();
  }

  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePicker(); });
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => { scheduled = false; refresh(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true }); else refresh();
})();