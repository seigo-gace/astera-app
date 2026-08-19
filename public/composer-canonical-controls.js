(() => {
  'use strict';

  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  const IS_COMPOSER = ROUTE === '/app' || ROUTE === '/app/new';
  const IS_TEMPLATE_SETTINGS = ROUTE === '/app/settings/templates';
  const OPTION_NAMES = ['高精度翻訳', 'Agent Mode', '書類作成', '外部Storage転送'];
  const INFO = {
    '高精度翻訳': '本文の構造・情報量を保ったまま翻訳だけを行います。要約・改善・校正・再構成は行いません。翻訳先は「@」から差し込みます。',
    'Agent Mode': '必要なStepと承認境界を持つ実行Modeです。Low／Medium／Highは「@」から選びます。未選択時は標準実行です。',
    'Private Mode': '本文・添付・中間物・ResultをAstera側へ永続保存しません。Composerを開くたび既定ONで、恒久OFF設定は持ちません。',
    '書類作成': 'Google Sheets固定書式を主対象に、Astera公式Templateまたは個別Templateを「@」から選びます。',
    '外部Storage転送': '利用者が接続した個人Storageへ一方向転送します。転送先は「@」から選びます。',
  };

  let overlay = null;
  let panel = null;
  let tooltip = null;
  let busy = false;

  const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const create = (tag, cls, value) => {
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

  function closePopup() {
    overlay?.remove();
    panel?.remove();
    overlay = null;
    panel = null;
  }

  function openPopup(title) {
    closePopup();
    overlay = button('', 'canon-picker-backdrop');
    overlay.setAttribute('aria-label', '選択を閉じる');
    overlay.addEventListener('click', closePopup);
    panel = create('section', 'canon-picker');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', title);
    const head = create('header', 'canon-picker-head');
    const heading = create('strong', '', title);
    const close = button('×', 'canon-picker-close');
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', closePopup);
    head.append(heading, close);
    const body = create('div', 'canon-picker-body');
    panel.append(head, body);
    document.body.append(overlay, panel);
    queueMicrotask(() => panel?.querySelector('button,select,input,a')?.focus());
    return body;
  }

  function showInfo(anchor, label) {
    tooltip?.remove();
    tooltip = create('div', 'canon-info-popover');
    tooltip.setAttribute('role', 'tooltip');
    const strong = create('strong', '', label);
    const p = create('p', '', INFO[label] || '');
    tooltip.append(strong, p);
    document.body.append(tooltip);
    const rect = anchor.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - Math.min(340, window.innerWidth - 16) - 8);
    tooltip.style.left = `${Math.min(Math.max(8, rect.left), maxLeft)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - tooltip.offsetHeight - 8, rect.bottom + 8)}px`;
    window.setTimeout(() => {
      const dismiss = (event) => {
        if (tooltip && !tooltip.contains(event.target) && event.target !== anchor) {
          tooltip.remove();
          tooltip = null;
          document.removeEventListener('pointerdown', dismiss, true);
        }
      };
      document.addEventListener('pointerdown', dismiss, true);
    }, 0);
  }

  function infoButton(label) {
    const b = button('?', 'canon-info-button');
    b.setAttribute('aria-label', `${label}の説明`);
    b.addEventListener('click', (event) => {
      event.stopPropagation();
      showInfo(b, label);
    });
    b.addEventListener('focus', () => showInfo(b, label));
    return b;
  }

  function findOption(label) {
    return Array.from(document.querySelectorAll('.canonical-option-grid label')).find((row) => text(row).includes(label));
  }
  function optionInput(label) {
    return findOption(label)?.querySelector('input[type="checkbox"]') || null;
  }
  function privateInput() {
    return document.querySelector('.canonical-private-toggle input[type="checkbox"]');
  }
  function labelledField(label) {
    return Array.from(document.querySelectorAll('.canonical-option-section .canonical-field')).find((row) => text(row).includes(label));
  }
  function targetLanguageInput() {
    return labelledField('翻訳先言語')?.querySelector('input') || null;
  }
  function agentModeSelect() {
    return labelledField('Agent強度')?.querySelector('select') || null;
  }
  function documentTemplateInput() {
    return labelledField('書類Template ID')?.querySelector('input') || null;
  }
  function storageDestinationInput() {
    return labelledField('Storage Destination ID')?.querySelector('input') || null;
  }
  function projectInput() {
    return document.querySelector('.canonical-two-column .canonical-field input');
  }

  function setNativeValue(input, value) {
    if (!input) return;
    const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function ensurePrivateDefault() {
    const input = privateInput();
    if (!(input instanceof HTMLInputElement) || input.disabled) return;
    const marker = document.documentElement.dataset.canonPrivateInitialized;
    if (!marker) {
      document.documentElement.dataset.canonPrivateInitialized = 'true';
      if (!input.checked) input.click();
    }
  }

  function makeSwitch(label, input, withInfo = true) {
    const row = create('div', 'canon-switch-row');
    const copy = create('div', 'canon-switch-copy');
    const name = create('strong', '', label);
    copy.append(name);
    if (withInfo && INFO[label]) copy.append(infoButton(label));
    const toggle = button('', 'canon-switch');
    toggle.setAttribute('role', 'switch');
    const sync = () => {
      const on = Boolean(input?.checked);
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      toggle.classList.toggle('is-on', on);
      toggle.disabled = Boolean(input?.disabled);
      toggle.innerHTML = '<span></span>';
    };
    toggle.addEventListener('click', () => {
      if (input instanceof HTMLInputElement && !input.disabled) input.click();
      sync();
      refreshCanonicalChips();
    });
    sync();
    row.append(copy, toggle);
    return row;
  }

  function openPlusPicker() {
    const body = openPopup('＋ 追加・実行Option');
    const fileInput = document.querySelector('.canonical-files input[type="file"]');
    if (fileInput instanceof HTMLInputElement) {
      const file = button('Fileを追加', 'canon-list-button');
      file.addEventListener('click', () => { closePopup(); fileInput.click(); });
      body.append(file);
    }

    const groupTitle = create('p', 'canon-group-label', '実行Option');
    body.append(groupTitle);
    OPTION_NAMES.forEach((label) => {
      const input = optionInput(label);
      if (input instanceof HTMLInputElement) body.append(makeSwitch(label, input, true));
    });
  }

  async function fetchJson(url) {
    try {
      const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  function records(payload, keys) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
    if (payload.data && typeof payload.data === 'object') return records(payload.data, keys);
    return [];
  }
  function recordValue(record, keys) {
    if (!record || typeof record !== 'object') return '';
    for (const key of keys) if (record[key] !== undefined && record[key] !== null && String(record[key]).trim()) return String(record[key]).trim();
    return '';
  }

  function selectRow(label, select) {
    const row = create('label', 'canon-select-row');
    row.append(create('span', '', label), select);
    return row;
  }

  async function openAtPicker() {
    const body = openPopup('@ 差し込み');
    const selected = OPTION_NAMES.filter((name) => optionInput(name)?.checked);
    const categories = [];
    if (selected.includes('高精度翻訳')) categories.push(['translation', '翻訳先言語']);
    if (selected.includes('Agent Mode')) categories.push(['agent', 'Agent Mode強度']);
    if (selected.includes('書類作成')) categories.push(['document', '書類Template']);
    if (selected.includes('外部Storage転送')) categories.push(['storage', '外部Storage転送先']);
    categories.push(['project', 'Project']);

    const kind = create('select', 'canon-select');
    categories.forEach(([value, label]) => {
      const option = create('option', '', label);
      option.value = value;
      kind.append(option);
    });
    body.append(selectRow('差し込む種類', kind));
    const slot = create('div', 'canon-at-slot');
    body.append(slot);

    const render = async () => {
      slot.replaceChildren();
      if (kind.value === 'translation') {
        const current = targetLanguageInput();
        const input = create('input', 'canon-input');
        input.placeholder = '翻訳先言語（BCP 47 / 言語名）';
        input.value = current?.value || '';
        const apply = button('翻訳先言語を差し込む', 'canon-primary');
        apply.addEventListener('click', () => { setNativeValue(current, input.value.trim()); closePopup(); refreshCanonicalChips(); });
        slot.append(selectRow('翻訳先言語', input), apply);
        return;
      }
      if (kind.value === 'agent') {
        const current = agentModeSelect();
        const select = create('select', 'canon-select');
        [['low','エージェント低'],['medium','エージェント中'],['high','エージェント高']].forEach(([value,label]) => { const o=create('option','',label);o.value=value;select.append(o); });
        select.value = current?.value || 'medium';
        const apply = button('Agent Modeを差し込む', 'canon-primary');
        apply.addEventListener('click', () => { setNativeValue(current, select.value); closePopup(); refreshCanonicalChips(); });
        slot.append(selectRow('強度', select), apply);
        return;
      }
      if (kind.value === 'document') {
        slot.append(create('p', 'canon-loading', 'Templateを読み込んでいます…'));
        const payload = await fetchJson('/api/templates');
        const items = records(payload, ['templates', 'items']);
        slot.replaceChildren();
        const source = create('select', 'canon-select');
        [['official','Astera公式テンプレート'],['personal','個別テンプレート']].forEach(([value,label]) => { const o=create('option','',label);o.value=value;source.append(o); });
        const template = create('select', 'canon-select');
        const fill = () => {
          template.replaceChildren();
          const filtered = items.filter((item) => {
            const flag = recordValue(item, ['template_source','source','scope','owner_scope']);
            const official = item?.is_official === true || flag === 'official' || flag === 'astera';
            return source.value === 'official' ? official : !official;
          });
          const placeholder = create('option', '', filtered.length ? 'Templateを選択' : source.value === 'official' ? '公式Template Catalog未登録' : '個別Template未登録');
          placeholder.value = '';
          template.append(placeholder);
          filtered.forEach((item) => {
            const id = recordValue(item, ['template_id','id','google_file_id']);
            const title = recordValue(item, ['title','name','display_name']) || id;
            if (!id) return;
            const option = create('option', '', title);
            option.value = id;
            template.append(option);
          });
        };
        source.addEventListener('change', fill);
        fill();
        const apply = button('書類Templateを差し込む', 'canon-primary');
        apply.addEventListener('click', () => {
          if (!template.value) return;
          const current = documentTemplateInput();
          setNativeValue(current, template.value);
          if (current instanceof HTMLElement) current.dataset.templateSource = source.value;
          closePopup();
          refreshCanonicalChips();
        });
        const settings = create('a', 'canon-secondary-link', '個別Template設定を開く');
        settings.href = '/app/settings/templates';
        slot.append(selectRow('Template区分', source), selectRow('Template', template), apply, settings);
        return;
      }
      if (kind.value === 'storage') {
        slot.append(create('p', 'canon-loading', '接続済みStorageを読み込んでいます…'));
        const payload = await fetchJson('/api/storage/destinations');
        const items = records(payload, ['destinations', 'items']);
        slot.replaceChildren();
        const select = create('select', 'canon-select');
        const active = items.filter((item) => !['revoked','deleted'].includes(recordValue(item, ['status']).toLowerCase()));
        const placeholder = create('option', '', active.length ? '転送先を選択' : '接続済みStorageがありません');
        placeholder.value = '';
        select.append(placeholder);
        active.forEach((item) => {
          const id = recordValue(item, ['destination_id','id']);
          const name = recordValue(item, ['display_name','name','provider']) || id;
          if (!id) return;
          const option = create('option', '', name);
          option.value = id;
          select.append(option);
        });
        const apply = button('転送先を差し込む', 'canon-primary');
        apply.addEventListener('click', () => { if (select.value) { setNativeValue(storageDestinationInput(), select.value); closePopup(); refreshCanonicalChips(); } });
        const settings = create('a', 'canon-secondary-link', '外部Storage設定を開く');
        settings.href = '/app/settings/storage-destinations';
        slot.append(selectRow('接続済みDestination', select), apply, settings);
        return;
      }
      if (kind.value === 'project') {
        slot.append(create('p', 'canon-loading', 'Projectを読み込んでいます…'));
        const payload = await fetchJson('/api/projects');
        const items = records(payload, ['projects', 'items']);
        slot.replaceChildren();
        const select = create('select', 'canon-select');
        const none = create('option', '', 'Projectなし'); none.value=''; select.append(none);
        items.forEach((item) => {
          const id = recordValue(item, ['project_id','id']);
          const name = recordValue(item, ['name','title']) || id;
          if (!id) return;
          const option = create('option', '', name); option.value=id; select.append(option);
        });
        select.value = projectInput()?.value || '';
        const apply = button('Projectを差し込む', 'canon-primary');
        apply.addEventListener('click', () => { setNativeValue(projectInput(), select.value); closePopup(); refreshCanonicalChips(); });
        slot.append(selectRow('Project', select), apply);
      }
    };
    kind.addEventListener('change', () => void render());
    await render();
  }

  function refreshCanonicalChips() {
    const host = document.querySelector('[data-exterior-chips]');
    if (!(host instanceof HTMLElement)) return;
    let summary = host.querySelector('[data-canon-summary]');
    if (!(summary instanceof HTMLElement)) {
      summary = create('span', 'canon-summary');
      summary.dataset.canonSummary = 'true';
      host.append(summary);
    }
    const parts = [];
    const lang = targetLanguageInput()?.value?.trim();
    if (optionInput('高精度翻訳')?.checked && lang) parts.push(`翻訳:${lang}`);
    if (optionInput('Agent Mode')?.checked) parts.push(`Agent:${agentModeSelect()?.value || 'medium'}`);
    const doc = documentTemplateInput()?.value?.trim();
    if (optionInput('書類作成')?.checked && doc) parts.push(`Template:${doc}`);
    const storage = storageDestinationInput()?.value?.trim();
    if (optionInput('外部Storage転送')?.checked && storage) parts.push(`転送:${storage}`);
    summary.textContent = parts.length ? parts.join(' / ') : '';
    summary.hidden = !parts.length;
  }

  function mountComposer() {
    if (!IS_COMPOSER) return;
    const tools = document.querySelector('[data-exterior-tools]');
    const card = document.querySelector('.canonical-composer-card');
    if (!(tools instanceof HTMLElement) || !(card instanceof HTMLElement)) return;
    ensurePrivateDefault();

    const currentButtons = Array.from(tools.querySelectorAll(':scope > .exterior-round-tool'));
    if (tools.dataset.canonControlsReady !== 'true' && currentButtons.length >= 2) {
      const plus = button('＋', 'exterior-round-tool canon-plus');
      plus.setAttribute('aria-label', 'Option・Fileを追加');
      plus.addEventListener('click', openPlusPicker);
      const at = button('@', 'exterior-round-tool canon-at');
      at.setAttribute('aria-label', '選択中機能へ差し込み');
      at.addEventListener('click', () => void openAtPicker());
      currentButtons[0].replaceWith(plus);
      currentButtons[1].replaceWith(at);

      const privateWrap = create('div', 'canon-private-compact');
      const pInput = privateInput();
      const pToggle = button('', 'canon-switch');
      pToggle.setAttribute('role', 'switch');
      const sync = () => {
        const on = Boolean(pInput?.checked);
        pToggle.setAttribute('aria-checked', on ? 'true' : 'false');
        pToggle.classList.toggle('is-on', on);
        pToggle.innerHTML = '<span></span>';
        pToggle.disabled = Boolean(pInput?.disabled);
      };
      pToggle.addEventListener('click', () => { if (pInput instanceof HTMLInputElement && !pInput.disabled) pInput.click(); sync(); });
      const label = create('span', 'canon-private-label', 'Private');
      privateWrap.append(label, pToggle, infoButton('Private Mode'));
      const chipHost = tools.querySelector('[data-exterior-chips]');
      tools.insertBefore(privateWrap, chipHost || null);
      sync();
      tools.dataset.canonControlsReady = 'true';
    }

    document.documentElement.classList.add('canon-composer-active');
    refreshCanonicalChips();
  }

  function canonicalTemplateSettings() {
    if (!IS_TEMPLATE_SETTINGS) return;
    const content = document.querySelector('.platform-page-content');
    if (!(content instanceof HTMLElement) || content.querySelector('[data-canon-template-settings]')) return;
    document.documentElement.classList.add('canon-template-settings-active');
    const firstPanel = Array.from(content.querySelectorAll(':scope > .platform-panel')).find((p) => text(p).includes('Template追加'));
    if (firstPanel instanceof HTMLElement) firstPanel.hidden = true;

    const section = create('section', 'canon-template-settings');
    section.dataset.canonTemplateSettings = 'true';
    section.innerHTML = `
      <header><div><h2>個別Template設定</h2><p>Google Sheets固定書式を登録し、Composerの「@」から差し込みます。</p></div><span class="canon-state">Draft</span></header>
      <div class="canon-template-callout"><strong>Astera公式Template</strong><p>公式TemplateはAstera側で用意・管理します。利用者は編集せず、Composerで公式／個別を選んで使用します。</p></div>
      <form class="canon-template-form">
        <label><span>名称</span><input name="title" required></label>
        <label><span>Google Sheets File ID</span><input name="google_file_id" required></label>
        <div class="canon-two"><label><span>Version</span><input name="version" value="1" required></label><label><span>Locale</span><input name="locale" value="ja-JP"></label></div>
        <div class="canon-two"><label><span>Time zone</span><input name="time_zone" value="Asia/Tokyo"></label><label><span>Output Format</span><select name="output_format"><option value="google-sheets">Google Sheets</option></select></label></div>
        <label><span>許可Sheet</span><input name="allowed_sheets" placeholder="例: Sheet1"></label>
        <label><span>許可Range／Named Range</span><input name="allowed_ranges" placeholder="例: B4:F20, invoice_items"></label>
        <label><span>禁止要素／注意事項</span><textarea name="prohibited_elements" rows="3" placeholder="Apps Script / Macro / Connected Sheets 等"></textarea></label>
        <div class="canon-template-actions">
          <a href="/app/settings/storage-destinations" class="canon-secondary-link">Google接続</a>
          <button type="button" data-action="validate">検査</button>
          <button type="button" data-action="preview">Preview</button>
          <button type="submit" class="canon-primary">個別Templateを登録</button>
        </div>
      </form>
      <p class="canon-form-status" role="status" aria-live="polite"></p>
      <div class="canon-template-lifecycle"><strong>登録後の管理</strong><span>名称変更</span><span>複製</span><span>有効／無効</span><span>Version履歴</span><span>削除</span><span>Diff Preview</span></div>`;
    content.prepend(section);

    const form = section.querySelector('form');
    const status = section.querySelector('.canon-form-status');
    section.querySelectorAll('[data-action]').forEach((action) => {
      action.addEventListener('click', () => {
        status.textContent = action.dataset.action === 'validate'
          ? 'Google接続・File権限・禁止要素・許可Rangeを検査してからReadyへ進みます。'
          : '原本Snapshotと変更許可Rangeを比較するDiff Previewを表示します。';
      });
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const data = new FormData(form);
      const payload = Object.fromEntries(data.entries());
      payload.template_source = 'personal';
      payload.provider = 'google-sheets';
      payload.allowed_sheets = String(payload.allowed_sheets || '').split(',').map((v) => v.trim()).filter(Boolean);
      payload.allowed_ranges = String(payload.allowed_ranges || '').split(',').map((v) => v.trim()).filter(Boolean);
      status.textContent = '登録中…';
      try {
        const response = await fetch('/api/templates', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        status.textContent = '個別Templateを登録しました。検査・Preview・Version状態はServer応答に従います。';
      } catch (error) {
        status.textContent = `登録できませんでした。入力は保持しています。${error instanceof Error ? ` (${error.message})` : ''}`;
      } finally {
        busy = false;
      }
    });
  }

  function run() {
    mountComposer();
    canonicalTemplateSettings();
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; run(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();