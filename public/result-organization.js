(() => {
  'use strict';

  let refreshQueued = false;

  const locale = () => (document.documentElement.lang || navigator.language || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const copy = () => locale() === 'en'
    ? {
        organize: 'Organize', pin: 'Pin', unpin: 'Unpin', archive: 'Archive', unarchive: 'Unarchive',
        folder: 'Folder', unassigned: 'No folder', unavailable: 'Organization data is not ready', failed: 'Could not update organization',
      }
    : {
        organize: '整理', pin: 'ピン留め', unpin: 'ピン留めを解除', archive: 'アーカイブ', unarchive: 'アーカイブ解除',
        folder: 'フォルダー', unassigned: 'フォルダーなし', unavailable: '整理機能のD1反映待ち', failed: '整理状態を更新できませんでした',
      };

  function resultIdFromPath() {
    const match = window.location.pathname.match(/^\/app\/results\/([^/?#]+)$/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
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
    try {
      const payload = await requestJson('/api/projects?status=active', { method: 'GET' });
      const source = Array.isArray(payload?.projects) ? payload.projects : Array.isArray(payload?.items) ? payload.items : [];
      return source.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const id = String(item.project_id || item.id || '').trim();
        if (!id) return [];
        return [{ id, name: String(item.name || item.title || id).trim() }];
      });
    } catch {
      return [];
    }
  }

  function folderIcon() {
    const icon = document.createElement('span');
    icon.className = 'result-organization-folder-icon';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function install() {
    const id = resultIdFromPath();
    if (!id) return;
    const details = document.querySelector('.result-summary-actions .result-more');
    if (!(details instanceof HTMLDetailsElement) || details.dataset.organizationInstalled === 'true') return;
    const summary = details.querySelector(':scope > summary');
    const menu = details.querySelector(':scope > div');
    if (!(summary instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;
    details.dataset.organizationInstalled = 'true';
    details.classList.add('result-organization-menu');
    summary.classList.add('result-organization-trigger');
    summary.replaceChildren(folderIcon());
    summary.setAttribute('aria-label', copy().organize);
    summary.title = copy().organize;

    const organization = document.createElement('div');
    organization.className = 'result-organization-controls';

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'result-organization-pin';

    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'result-organization-archive';

    const folderLabel = document.createElement('label');
    folderLabel.className = 'result-organization-folder';
    const folderText = document.createElement('span');
    folderText.textContent = copy().folder;
    const folderSelect = document.createElement('select');
    folderSelect.setAttribute('aria-label', copy().folder);
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = copy().unassigned;
    folderSelect.append(emptyOption);
    folderLabel.append(folderText, folderSelect);

    const status = document.createElement('span');
    status.className = 'result-organization-status';
    status.hidden = true;

    organization.append(pin, archive, folderLabel, status);
    menu.prepend(organization);

    let state = { pinned: false, archived: false, projectId: '' };
    let ready = false;

    const render = () => {
      pin.textContent = state.pinned ? copy().unpin : copy().pin;
      archive.textContent = state.archived ? copy().unarchive : copy().archive;
      pin.disabled = !ready || state.archived;
      archive.disabled = !ready;
      folderSelect.disabled = !ready;
      folderSelect.value = state.projectId || '';
    };

    const patch = async (body) => {
      if (!ready) return;
      pin.disabled = true;
      archive.disabled = true;
      folderSelect.disabled = true;
      status.hidden = true;
      try {
        const payload = await requestJson(`/api/results/${encodeURIComponent(id)}/organization`, {
          method: 'PATCH', body: JSON.stringify(body),
        });
        state = {
          pinned: payload?.pinned === true,
          archived: payload?.archived === true,
          projectId: state.projectId,
        };
        window.dispatchEvent(new CustomEvent('astera:result-organization-changed', { detail: { resultId: id, ...state } }));
      } catch {
        status.textContent = copy().failed;
        status.hidden = false;
      } finally {
        render();
      }
    };

    pin.addEventListener('click', () => void patch({ pinned: !state.pinned }));
    archive.addEventListener('click', () => void patch({ archived: !state.archived }));
    folderSelect.addEventListener('change', async () => {
      if (!ready) return;
      const target = folderSelect.value || null;
      folderSelect.disabled = true;
      status.hidden = true;
      try {
        await requestJson(`/api/results/${encodeURIComponent(id)}`, {
          method: 'PATCH', body: JSON.stringify({ project_id: target }),
        });
        state.projectId = target || '';
        window.location.reload();
      } catch {
        status.textContent = copy().failed;
        status.hidden = false;
        render();
      }
    });

    Promise.all([
      requestJson(`/api/results/${encodeURIComponent(id)}/organization`, { method: 'GET' }),
      loadProjects(),
    ]).then(([payload, projects]) => {
      for (const project of projects) {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        folderSelect.append(option);
      }
      state = {
        pinned: payload?.pinned === true,
        archived: payload?.archived === true,
        projectId: typeof payload?.project_id === 'string' ? payload.project_id : '',
      };
      ready = true;
      render();
    }).catch((error) => {
      ready = false;
      status.textContent = error?.code === 'RESULT_ORGANIZATION_MIGRATION_REQUIRED' ? copy().unavailable : copy().failed;
      status.hidden = false;
      render();
    });

    render();
  }

  function schedule() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      install();
    });
  }

  install();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
