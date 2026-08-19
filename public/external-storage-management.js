(() => {
  'use strict';

  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  if (ROUTE !== '/app/settings/storage-destinations') return;

  let mounted = false;
  let busy = false;

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
  async function request(url, init = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
      ...init,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const source = payload && typeof payload === 'object' ? (payload.error && typeof payload.error === 'object' ? payload.error : payload) : null;
      const message = text(source?.message) || `HTTP ${response.status}`;
      const code = text(source?.code);
      throw new Error(code ? `${message} [${code}]` : message);
    }
    return payload;
  }
  const destinationsFrom = (payload) => Array.isArray(payload?.destinations) ? payload.destinations : Array.isArray(payload?.items) ? payload.items : [];
  const idOf = (item) => text(item?.destination_id || item?.id);
  const scopesOf = (item) => Array.isArray(item?.scopes) ? item.scopes.filter((scope) => typeof scope === 'string') : [];
  const stateOf = (item) => text(item?.state || item?.status || 'Unavailable');
  const labelOf = (item) => text(item?.display_name || item?.account_label || item?.provider || idOf(item)) || '外部Storage';
  const dateLabel = (value) => {
    const raw = text(value);
    if (!raw) return '未確認';
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
  };

  async function reauthorize(item, status) {
    if (busy) return;
    busy = true;
    status.textContent = '再認証準備を確認しています…';
    try {
      const payload = await request('/api/storage/destinations/authorize', {
        method: 'POST',
        body: JSON.stringify({ provider: text(item.provider), return_to: window.location.pathname }),
      });
      const url = text(payload?.authorization_url || payload?.url || payload?.redirect_url);
      if (!url) throw new Error('Authorization URLがありません。');
      window.location.assign(url);
    } catch (error) {
      status.textContent = `再認証は現在利用できません。${error instanceof Error ? ` ${error.message}` : ''}`;
    } finally {
      busy = false;
    }
  }

  function detailRow(label, value) {
    const row = create('div');
    row.append(create('dt', '', label), create('dd', '', value));
    return row;
  }

  function cardFor(item, status, reload) {
    const card = create('article', 'canon-storage-card');
    const head = create('div', 'canon-storage-card-head');
    const heading = create('div');
    heading.append(create('strong', '', labelOf(item)), create('small', '', text(item.provider) || 'provider不明'));
    head.append(heading, create('span', `canon-storage-state is-${stateOf(item).toLowerCase()}`, stateOf(item)));

    const facts = create('dl', 'canon-storage-facts');
    facts.append(
      detailRow('Scope', scopesOf(item).join(', ') || '未確認'),
      detailRow('Root Folder', text(item.root_folder) || 'Provider Root'),
      detailRow('最終検証', dateLabel(item.last_verified_at)),
      detailRow('Credential', item.credential_reference_present ? 'Vault Referenceあり' : 'Credential参照なし'),
      detailRow('更新日時', dateLabel(item.updated_at)),
    );

    const editor = create('form', 'canon-storage-editor');
    const label = create('label');
    label.append(create('span', '', '表示名'));
    const labelInput = create('input');
    labelInput.name = 'account_label';
    labelInput.value = labelOf(item);
    label.append(labelInput);
    const root = create('label');
    root.append(create('span', '', 'Root Folder'));
    const rootInput = create('input');
    rootInput.name = 'root_folder';
    rootInput.value = text(item.root_folder);
    rootInput.placeholder = '空欄 = Provider Root';
    root.append(rootInput);
    const save = button('設定を保存', 'canon-storage-primary');
    save.type = 'submit';
    editor.append(label, root, save);
    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      status.textContent = 'Storage設定を保存しています…';
      try {
        await request(`/api/storage/destinations/${encodeURIComponent(idOf(item))}`, {
          method: 'PATCH',
          body: JSON.stringify({ account_label: labelInput.value.trim(), root_folder: rootInput.value.trim() || null, expected_updated_at: text(item.updated_at) }),
        });
        status.textContent = 'Storage設定を保存しました。';
        await reload();
      } catch (error) {
        status.textContent = `Storage設定を保存できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`;
      } finally {
        busy = false;
      }
    });

    const actions = create('div', 'canon-storage-actions');
    const reauth = button('再認証');
    reauth.addEventListener('click', () => void reauthorize(item, status));
    const test = button('接続Test（未接続）');
    test.disabled = true;
    test.setAttribute('aria-disabled', 'true');
    test.title = 'Connection Test Backendは未接続です。';
    const remove = button('接続を削除', 'is-danger');
    remove.addEventListener('click', async () => {
      if (busy || !window.confirm(`「${labelOf(item)}」の接続を削除します。`)) return;
      busy = true;
      status.textContent = '接続を削除しています…';
      try {
        const payload = await request(`/api/storage/destinations/${encodeURIComponent(idOf(item))}`, { method: 'DELETE' });
        status.textContent = payload?.credential_cleanup_pending
          ? '接続をRevokeしました。Provider Token／Vault Secretの実CleanupはOAuth・Credential Adapter接続後に行います。'
          : '接続を削除しました。';
        await reload();
      } catch (error) {
        status.textContent = `接続を削除できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`;
      } finally {
        busy = false;
      }
    });
    actions.append(reauth, test, remove);

    if (!text(item.provider) || !['google-drive', 'google-sheets'].includes(text(item.provider))) reauth.disabled = true;
    card.append(head, facts, editor, actions);
    return card;
  }

  async function mount() {
    if (mounted) return;
    const content = document.querySelector('.platform-page-content');
    if (!(content instanceof HTMLElement)) return;
    mounted = true;
    document.documentElement.dataset.canonExternalStorageManagement = 'true';

    const oldListPanel = Array.from(content.querySelectorAll(':scope > .platform-panel')).find((panel) => (panel.textContent || '').includes('接続済みStorage'));
    if (oldListPanel instanceof HTMLElement) oldListPanel.hidden = true;

    const section = create('section', 'canon-storage-manager');
    section.dataset.canonStorageManager = 'true';
    const head = create('header');
    const copy = create('div');
    copy.append(create('h2', '', '接続済みStorage管理'), create('p', '', 'Scope、Root Folder、再認証状態、最終検証、Revokeを接続先ごとに管理します。'));
    const refresh = button('再読込');
    head.append(copy, refresh);
    const notice = create('div', 'canon-storage-notice');
    notice.append(create('strong', '', 'OAuth / Connection Test状態'), create('p', '', '現在OAuth BrokerとConnection Test Backendは未接続です。接続済みDestinationの表示・Root Folder更新・Revokeは利用できます。'));
    const status = create('p', 'canon-storage-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const list = create('div', 'canon-storage-list');
    section.append(head, notice, status, list);
    content.prepend(section);

    const reload = async () => {
      list.replaceChildren(create('p', 'canon-storage-empty', '接続先を読み込んでいます…'));
      try {
        const items = destinationsFrom(await request('/api/storage/destinations'));
        list.replaceChildren();
        if (!items.length) list.append(create('p', 'canon-storage-empty', '接続済みStorageはありません。OAuth Broker接続後に追加できます。'));
        else items.forEach((item) => list.append(cardFor(item, status, reload)));
      } catch (error) {
        list.replaceChildren(create('p', 'canon-storage-empty is-error', `Storage一覧を取得できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`));
      }
    };
    refresh.addEventListener('click', () => void reload());
    await reload();
  }

  const schedule = () => queueMicrotask(() => void mount());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
