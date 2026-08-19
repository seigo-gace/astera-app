(() => {
  'use strict';

  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  if (ROUTE !== '/app/settings/templates') return;

  let mounted = false;
  let busy = false;
  let editingId = '';
  let editingVersion = 0;

  const text = (value) => typeof value === 'string' ? value.trim() : '';
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
  const json = async (response) => response.json().catch(() => null);
  const apiError = (payload, fallback) => {
    const error = payload && typeof payload === 'object' ? (payload.error && typeof payload.error === 'object' ? payload.error : payload) : null;
    return text(error?.message) || fallback;
  };
  async function request(url, init = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
      ...init,
    });
    const payload = await json(response);
    if (!response.ok) throw new Error(apiError(payload, `HTTP ${response.status}`));
    return payload;
  }
  const templatesFrom = (payload) => Array.isArray(payload?.templates) ? payload.templates : Array.isArray(payload?.items) ? payload.items : [];
  const templateFrom = (payload) => payload?.template && typeof payload.template === 'object' ? payload.template : null;
  const versionsFrom = (payload) => Array.isArray(payload?.versions) ? payload.versions : [];

  function field(form, name) { return form.elements.namedItem(name); }
  function setField(form, name, value) {
    const target = field(form, name);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) target.value = value ?? '';
  }
  function listValue(value) { return Array.isArray(value) ? value.join(', ') : ''; }
  function formPayload(form) {
    const data = new FormData(form);
    return {
      title: text(String(data.get('title') || '')),
      provider: 'google-sheets',
      template_source: 'personal',
      google_file_id: text(String(data.get('google_file_id') || '')),
      locale: text(String(data.get('locale') || '')) || 'ja-JP',
      time_zone: text(String(data.get('time_zone') || '')) || 'Asia/Tokyo',
      output_format: 'google-sheets',
      allowed_sheets: String(data.get('allowed_sheets') || '').split(',').map((v) => v.trim()).filter(Boolean),
      allowed_ranges: String(data.get('allowed_ranges') || '').split(',').map((v) => v.trim()).filter(Boolean),
      prohibited_elements: text(String(data.get('prohibited_elements') || '')),
      ...(editingId ? { expected_version: editingVersion } : {}),
    };
  }

  function lifecycleLabel(template) {
    const state = text(template.lifecycle_state || template.state || 'draft');
    const map = { draft: 'Draft', validating: 'Validating', ready: 'Ready', warning: 'Warning', rejected: 'Rejected', disabled: 'Disabled', deleted: 'Deleted' };
    return map[state] || state || 'Draft';
  }

  function resetEditor(section) {
    const form = section.querySelector('.canon-template-form');
    if (!(form instanceof HTMLFormElement)) return;
    editingId = '';
    editingVersion = 0;
    form.reset();
    setField(form, 'version', '1');
    setField(form, 'locale', 'ja-JP');
    setField(form, 'time_zone', 'Asia/Tokyo');
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.textContent = '個別Templateを登録';
    const cancel = form.querySelector('[data-template-cancel-edit]');
    if (cancel) cancel.remove();
    const state = section.querySelector('.canon-state');
    if (state) state.textContent = 'Draft';
  }

  function editTemplate(section, template) {
    const form = section.querySelector('.canon-template-form');
    if (!(form instanceof HTMLFormElement)) return;
    editingId = text(template.id || template.template_id);
    editingVersion = Number(template.version || 0);
    setField(form, 'title', template.title || '');
    setField(form, 'google_file_id', template.google_file_id || '');
    setField(form, 'version', String(editingVersion || 1));
    setField(form, 'locale', template.locale || 'ja-JP');
    setField(form, 'time_zone', template.time_zone || 'Asia/Tokyo');
    setField(form, 'allowed_sheets', listValue(template.allowed_sheets));
    setField(form, 'allowed_ranges', listValue(template.allowed_ranges));
    setField(form, 'prohibited_elements', template.prohibited_elements || '');
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.textContent = 'Templateを更新';
    if (!form.querySelector('[data-template-cancel-edit]')) {
      const cancel = button('編集をやめる', 'canon-template-cancel-edit');
      cancel.dataset.templateCancelEdit = 'true';
      cancel.addEventListener('click', () => resetEditor(section));
      form.querySelector('.canon-template-actions')?.append(cancel);
    }
    const state = section.querySelector('.canon-state');
    if (state) state.textContent = lifecycleLabel(template);
    form.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function renderVersions(host, payload) {
    host.replaceChildren();
    const versions = versionsFrom(payload);
    if (!versions.length) {
      host.append(create('p', 'canon-template-empty', 'Version履歴はありません。'));
      return;
    }
    const list = create('ol', 'canon-template-version-list');
    versions.forEach((item) => {
      const li = create('li');
      const top = create('div', 'canon-template-version-head');
      top.append(create('strong', '', `v${Number(item.version || 0)}`), create('span', '', text(item.change_kind) || 'update'));
      const when = create('small', '', text(item.created_at) || '');
      li.append(top, when);
      list.append(li);
    });
    host.append(list);
  }

  async function showVersions(template, card, status) {
    const id = encodeURIComponent(text(template.id || template.template_id));
    let host = card.querySelector('[data-template-versions]');
    if (!(host instanceof HTMLElement)) {
      host = create('div', 'canon-template-versions');
      host.dataset.templateVersions = 'true';
      card.append(host);
    }
    host.textContent = 'Version履歴を読み込んでいます…';
    try {
      renderVersions(host, await request(`/api/templates/${id}/versions`));
    } catch (error) {
      host.textContent = `Version履歴を取得できませんでした。${error instanceof Error ? ` (${error.message})` : ''}`;
      status.textContent = host.textContent;
    }
  }

  function templateCard(section, template, status, reload) {
    const card = create('article', 'canon-template-card');
    card.dataset.templateId = text(template.id || template.template_id);
    const head = create('div', 'canon-template-card-head');
    const title = create('div');
    title.append(create('strong', '', text(template.title) || '名称未設定'), create('small', '', `v${Number(template.version || 1)} · ${lifecycleLabel(template)}`));
    const badge = create('span', `canon-template-state is-${text(template.lifecycle_state || 'draft')}`, template.enabled === false ? '無効' : '有効');
    head.append(title, badge);

    const facts = create('dl', 'canon-template-facts');
    [
      ['Google Sheets', text(template.google_file_id) || '未設定'],
      ['Locale', text(template.locale) || 'ja-JP'],
      ['Time zone', text(template.time_zone) || 'Asia/Tokyo'],
      ['許可Sheet', listValue(template.allowed_sheets) || '未指定'],
      ['許可Range', listValue(template.allowed_ranges) || '未指定'],
    ].forEach(([label, value]) => {
      const row = create('div'); row.append(create('dt', '', label), create('dd', '', value)); facts.append(row);
    });

    const actions = create('div', 'canon-template-card-actions');
    const edit = button('編集');
    edit.addEventListener('click', () => editTemplate(section, template));
    const duplicate = button('複製');
    duplicate.addEventListener('click', async () => {
      if (busy) return; busy = true; status.textContent = '複製中…';
      try {
        const id = encodeURIComponent(text(template.id || template.template_id));
        await request(`/api/templates/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ title: `${text(template.title) || 'Template'} コピー` }) });
        status.textContent = 'Templateを複製しました。'; await reload();
      } catch (error) { status.textContent = `複製できませんでした。${error instanceof Error ? ` (${error.message})` : ''}`; }
      finally { busy = false; }
    });
    const toggle = button(template.enabled === false ? '有効化' : '無効化');
    toggle.addEventListener('click', async () => {
      if (busy) return; busy = true; status.textContent = `${toggle.textContent}中…`;
      try {
        const id = encodeURIComponent(text(template.id || template.template_id));
        await request(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: template.enabled === false, expected_version: Number(template.version || 0) }) });
        status.textContent = template.enabled === false ? 'Templateを有効化しました。' : 'Templateを無効化しました。'; await reload();
      } catch (error) { status.textContent = `状態を変更できませんでした。${error instanceof Error ? ` (${error.message})` : ''}`; }
      finally { busy = false; }
    });
    const versions = button('Version履歴');
    versions.addEventListener('click', () => void showVersions(template, card, status));
    const remove = button('削除', 'is-danger');
    remove.addEventListener('click', async () => {
      if (busy || !window.confirm(`「${text(template.title) || 'Template'}」を削除します。元に戻せません。`)) return;
      busy = true; status.textContent = '削除中…';
      try {
        const id = encodeURIComponent(text(template.id || template.template_id));
        await request(`/api/templates/${id}`, { method: 'DELETE' });
        if (editingId === text(template.id || template.template_id)) resetEditor(section);
        status.textContent = 'Templateを削除しました。'; await reload();
      } catch (error) { status.textContent = `削除できませんでした。${error instanceof Error ? ` (${error.message})` : ''}`; }
      finally { busy = false; }
    });
    actions.append(edit, duplicate, toggle, versions, remove);
    card.append(head, facts, actions);
    return card;
  }

  async function mount() {
    if (mounted) return;
    const section = document.querySelector('[data-canon-template-settings]');
    if (!(section instanceof HTMLElement)) return;
    const oldForm = section.querySelector('.canon-template-form');
    const status = section.querySelector('.canon-form-status');
    if (!(oldForm instanceof HTMLFormElement) || !(status instanceof HTMLElement)) return;
    mounted = true;
    document.documentElement.dataset.canonTemplateManagement = 'true';

    const form = oldForm.cloneNode(true);
    oldForm.replaceWith(form);
    const validate = form.querySelector('[data-action="validate"]');
    const preview = form.querySelector('[data-action="preview"]');
    [validate, preview].forEach((item) => {
      if (!(item instanceof HTMLButtonElement)) return;
      item.disabled = true;
      item.setAttribute('aria-disabled', 'true');
      item.title = 'Google Sheets実検査／Diff Preview Backendは未接続です。';
      item.textContent = item.dataset.action === 'validate' ? '検査（未接続）' : 'Preview（未接続）';
    });
    const lifecycle = section.querySelector('.canon-template-lifecycle');
    if (lifecycle instanceof HTMLElement) lifecycle.hidden = true;

    const manager = create('section', 'canon-template-manager');
    manager.dataset.canonTemplateManager = 'true';
    const managerHead = create('header');
    const copy = create('div');
    copy.append(create('h3', '', '登録済み個別Template'), create('p', '', '編集、複製、有効/無効、Version履歴、削除を管理します。'));
    const refresh = button('再読込');
    managerHead.append(copy, refresh);
    const list = create('div', 'canon-template-list');
    manager.append(managerHead, list);
    section.append(manager);

    const reload = async () => {
      list.replaceChildren(create('p', 'canon-template-empty', 'Templateを読み込んでいます…'));
      try {
        const items = templatesFrom(await request('/api/templates'));
        list.replaceChildren();
        if (!items.length) list.append(create('p', 'canon-template-empty', '登録済みの個別Templateはありません。'));
        else items.forEach((item) => list.append(templateCard(section, item, status, reload)));
      } catch (error) {
        list.replaceChildren(create('p', 'canon-template-empty is-error', `Template一覧を取得できませんでした。${error instanceof Error ? ` (${error.message})` : ''}`));
      }
    };
    refresh.addEventListener('click', () => void reload());

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const payload = formPayload(form);
      busy = true;
      status.textContent = editingId ? '更新中…' : '登録中…';
      try {
        if (editingId) {
          const id = encodeURIComponent(editingId);
          const saved = templateFrom(await request(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }));
          status.textContent = saved ? 'Templateを更新しました。' : 'Templateを更新しました。';
        } else {
          await request('/api/templates', { method: 'POST', body: JSON.stringify(payload) });
          status.textContent = '個別Templateを登録しました。';
        }
        resetEditor(section);
        await reload();
      } catch (error) {
        status.textContent = `${editingId ? '更新' : '登録'}できませんでした。入力は保持しています。${error instanceof Error ? ` (${error.message})` : ''}`;
      } finally {
        busy = false;
      }
    });

    await reload();
  }

  const schedule = () => queueMicrotask(() => void mount());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
