(() => {
  'use strict';

  let menu = null;
  let menuOpen = false;
  let currentResultId = '';
  let organizationReady = false;
  let resultReady = false;
  let state = { pinned: false, archived: false, projectId: '' };

  const locale = () => (document.documentElement.lang || navigator.language || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const copy = () => locale() === 'en'
    ? {
        organize: 'Organize', pin: 'Pin', unpin: 'Unpin', archive: 'Archive', unarchive: 'Unarchive',
        folder: 'Move to folder', unassigned: 'No folder', remove: 'Delete', unavailable: 'Organization data is not ready',
        failed: 'Could not update organization', noResult: 'Open a saved result to organize it.', loading: 'Loading…', deleteConfirm: 'Delete this result?'
      }
    : {
        organize: '整理', pin: 'ピン留め', unpin: 'ピン留めを解除', archive: 'アーカイブ', unarchive: 'アーカイブ解除',
        folder: 'フォルダーに移動', unassigned: 'フォルダーなし', remove: '削除', unavailable: '整理機能のD1反映待ち',
        failed: '整理状態を更新できませんでした', noResult: '保存済みResultを開くと整理できます。', loading: '読み込み中…', deleteConfirm: 'このResultを削除予定状態にしますか？'
      };

  function resultIdFromPath() {
    const match = window.location.pathname.match(/^\/app\/results\/([^/?#]+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta instanceof HTMLMetaElement && meta.content.trim()) return meta.content.trim();
    const cookie = document.cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('csrf_token='));
    return cookie ? decodeURIComponent(cookie.slice('csrf_token='.length)) : '';
  }

  async function requestJson(url, options = {}) {
    const method = options.method || 'GET';
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const csrf = csrfToken();
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const response = await fetch(url, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `HTTP_${response.status}`);
      error.code = payload?.error?.code || `HTTP_${response.status}`;
      throw error;
    }
    return payload;
  }

  async function loadProjects() {
    const payload = await requestJson('/api/projects?status=active');
    const source = Array.isArray(payload?.projects) ? payload.projects : Array.isArray(payload?.items) ? payload.items : [];
    return source.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const id = String(item.project_id || item.id || '').trim();
      if (!id) return [];
      return [{ id, name: String(item.name || item.title || id).trim() }];
    });
  }

  function resultProjectId(payload) {
    const root = payload && typeof payload === 'object' ? payload : {};
    const result = root.result && typeof root.result === 'object' ? root.result : root.data && typeof root.data === 'object' ? root.data : root;
    return typeof result.project_id === 'string' ? result.project_id : '';
  }

  function ensureMenu() {
    if (menu?.root?.isConnected) return menu;

    const root = document.createElement('div');
    root.className = 'result-organization-popover';
    root.setAttribute('role', 'menu');
    root.setAttribute('aria-label', copy().organize);
    root.hidden = true;

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'result-organization-popover-action';

    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'result-organization-popover-action';

    const folderLabel = document.createElement('label');
    folderLabel.className = 'result-organization-popover-folder';
    const folderText = document.createElement('span');
    folderText.textContent = copy().folder;
    const folderSelect = document.createElement('select');
    folderSelect.setAttribute('aria-label', copy().folder);
    folderLabel.append(folderText, folderSelect);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'result-organization-popover-action is-danger';
    remove.textContent = copy().remove;

    const status = document.createElement('div');
    status.className = 'result-organization-popover-status';
    status.setAttribute('role', 'status');

    root.append(pin, archive, folderLabel, remove, status);
    document.body.append(root);

    pin.addEventListener('click', async () => {
      if (!currentResultId || !organizationReady) return;
      await patchOrganization({ pinned: !state.pinned });
    });

    archive.addEventListener('click', async () => {
      if (!currentResultId || !organizationReady) return;
      await patchOrganization({ archived: !state.archived });
    });

    folderSelect.addEventListener('change', async () => {
      if (!currentResultId || !resultReady) return;
      const target = folderSelect.value || null;
      setBusy(true);
      status.textContent = '';
      try {
        await requestJson(`/api/results/${encodeURIComponent(currentResultId)}`, { method: 'PATCH', body: { project_id: target } });
        state.projectId = target || '';
        window.dispatchEvent(new CustomEvent('astera:result-organization-changed', { detail: { resultId: currentResultId, ...state } }));
      } catch {
        status.textContent = copy().failed;
      } finally {
        setBusy(false);
        render();
      }
    });

    remove.addEventListener('click', async () => {
      if (!currentResultId || !resultReady) return;
      if (!window.confirm(copy().deleteConfirm)) return;
      setBusy(true);
      status.textContent = '';
      try {
        await requestJson(`/api/results/${encodeURIComponent(currentResultId)}`, { method: 'DELETE', body: {} });
        closeMenu();
        window.location.reload();
      } catch {
        status.textContent = copy().failed;
        setBusy(false);
        render();
      }
    });

    menu = { root, pin, archive, folderSelect, remove, status };
    return menu;
  }

  function setBusy(busy) {
    const ui = ensureMenu();
    ui.pin.disabled = busy || !organizationReady;
    ui.archive.disabled = busy || !organizationReady;
    ui.folderSelect.disabled = busy || !resultReady;
    ui.remove.disabled = busy || !resultReady;
  }

  function render() {
    const ui = ensureMenu();
    ui.root.setAttribute('aria-label', copy().organize);
    ui.pin.textContent = state.pinned ? copy().unpin : copy().pin;
    ui.archive.textContent = state.archived ? copy().unarchive : copy().archive;
    ui.remove.textContent = copy().remove;
    ui.folderSelect.value = state.projectId || '';
    setBusy(false);
  }

  async function patchOrganization(body) {
    const ui = ensureMenu();
    setBusy(true);
    ui.status.textContent = '';
    try {
      const payload = await requestJson(`/api/results/${encodeURIComponent(currentResultId)}/organization`, { method: 'PATCH', body });
      state.pinned = payload?.pinned === true;
      state.archived = payload?.archived === true;
      if (typeof payload?.project_id === 'string') state.projectId = payload.project_id;
      window.dispatchEvent(new CustomEvent('astera:result-organization-changed', { detail: { resultId: currentResultId, ...state } }));
    } catch (error) {
      ui.status.textContent = error?.code === 'RESULT_ORGANIZATION_MIGRATION_REQUIRED' ? copy().unavailable : copy().failed;
    } finally {
      setBusy(false);
      render();
    }
  }

  async function loadMenuState() {
    const ui = ensureMenu();
    currentResultId = resultIdFromPath();
    organizationReady = false;
    resultReady = false;
    state = { pinned: false, archived: false, projectId: '' };
    ui.status.textContent = currentResultId ? copy().loading : copy().noResult;
    ui.folderSelect.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = copy().unassigned;
    ui.folderSelect.append(empty);
    render();

    if (!currentResultId) return;

    const [organizationResult, projectsResult, resultResult] = await Promise.allSettled([
      requestJson(`/api/results/${encodeURIComponent(currentResultId)}/organization`),
      loadProjects(),
      requestJson(`/api/results/${encodeURIComponent(currentResultId)}`),
    ]);

    if (projectsResult.status === 'fulfilled') {
      for (const project of projectsResult.value) {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        ui.folderSelect.append(option);
      }
    }

    if (resultResult.status === 'fulfilled') {
      resultReady = true;
      state.projectId = resultProjectId(resultResult.value);
    }

    if (organizationResult.status === 'fulfilled') {
      organizationReady = true;
      state.pinned = organizationResult.value?.pinned === true;
      state.archived = organizationResult.value?.archived === true;
      if (typeof organizationResult.value?.project_id === 'string') state.projectId = organizationResult.value.project_id;
    } else {
      const error = organizationResult.reason;
      ui.status.textContent = error?.code === 'RESULT_ORGANIZATION_MIGRATION_REQUIRED' ? copy().unavailable : copy().failed;
    }

    if (organizationReady) ui.status.textContent = '';
    else if (!ui.status.textContent) ui.status.textContent = copy().failed;
    render();
  }

  function openMenu() {
    const ui = ensureMenu();
    ui.root.hidden = false;
    menuOpen = true;
    void loadMenuState();
  }

  function closeMenu() {
    const ui = ensureMenu();
    ui.root.hidden = true;
    menuOpen = false;
  }

  function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest('.platform-header-organize');
    if (trigger) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      toggleMenu();
      return;
    }
    if (menuOpen && !target.closest('.result-organization-popover')) closeMenu();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault();
      closeMenu();
      document.querySelector('.platform-header-organize')?.focus();
    }
  });

  window.addEventListener('popstate', closeMenu);
})();
