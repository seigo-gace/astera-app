(() => {
  'use strict';

  const PROJECT_BATCH = 5;
  const HISTORY_BATCH = 5;
  let projectsPromise = null;
  let refreshQueued = false;

  const locale = () => (document.documentElement.lang || navigator.language || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const copy = () => locale() === 'en'
    ? {
        projects: 'Folders',
        loading: 'Loading…',
        empty: 'No folders yet',
        historyEmpty: 'No history in this folder',
        moreHistory: 'Show more',
        moreProjects: 'Show more folders',
        openProject: 'Open folders',
      }
    : {
        projects: 'フォルダー',
        loading: '読み込み中…',
        empty: 'まだフォルダーはありません',
        historyEmpty: 'このフォルダーには履歴がありません',
        moreHistory: 'もっと見る',
        moreProjects: 'さらに表示',
        openProject: 'フォルダー一覧を開く',
      };

  function arrayFrom(payload, keys) {
    if (!payload || typeof payload !== 'object') return [];
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
  }

  function text(record, keys, fallback = '') {
    if (!record || typeof record !== 'object') return fallback;
    for (const key of keys) {
      const value = record[key];
      if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
    }
    return fallback;
  }

  function normalizeProjects(payload) {
    return arrayFrom(payload, ['projects', 'items']).flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return [];
      const id = text(entry, ['project_id', 'id']);
      if (!id) return [];
      return [{
        id,
        name: text(entry, ['name', 'title'], `Project ${index + 1}`),
      }];
    });
  }

  function normalizeHistory(payload) {
    return arrayFrom(payload, ['history', 'items', 'results']).flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') return [];
      const id = text(entry, ['result_id', 'id']);
      if (!id) return [];
      return [{ id, title: text(entry, ['title', 'prompt', 'name'], `Result ${index + 1}`) }];
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return payload;
  }

  function loadProjects() {
    if (!projectsPromise) {
      projectsPromise = fetchJson('/api/projects?status=active').then(normalizeProjects).catch(() => []);
    }
    return projectsPromise;
  }

  function folderIcon() {
    const icon = document.createElement('span');
    icon.className = 'sidebar-project-folder-icon';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function chevronIcon() {
    const icon = document.createElement('span');
    icon.className = 'sidebar-project-chevron';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  async function loadHistory(projectId, historyHost, moreButton, state) {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    moreButton.disabled = true;
    try {
      const params = new URLSearchParams({ project: projectId, limit: String(HISTORY_BATCH) });
      if (state.cursor) params.set('cursor', state.cursor);
      const payload = await fetchJson(`/api/history?${params.toString()}`);
      const items = normalizeHistory(payload);
      if (!state.loaded) historyHost.replaceChildren();
      if (!items.length && !state.loaded) {
        const empty = document.createElement('span');
        empty.className = 'sidebar-project-history-empty';
        empty.textContent = copy().historyEmpty;
        historyHost.append(empty);
      } else {
        items.forEach((item) => {
          const link = document.createElement('a');
          link.href = `/app/results/${encodeURIComponent(item.id)}`;
          link.className = 'sidebar-project-history-link';
          link.title = item.title;
          link.textContent = item.title;
          historyHost.append(link);
        });
      }
      state.loaded = true;
      state.cursor = typeof payload?.next_cursor === 'string' ? payload.next_cursor : '';
      state.hasMore = payload?.has_more === true && Boolean(state.cursor);
      moreButton.hidden = !state.hasMore;
    } catch {
      state.hasMore = false;
      moreButton.hidden = true;
    } finally {
      state.loading = false;
      moreButton.disabled = false;
    }
  }

  function createProjectItem(project) {
    const details = document.createElement('details');
    details.className = 'sidebar-project-item';
    details.dataset.projectId = project.id;

    const summary = document.createElement('summary');
    summary.className = 'sidebar-project-summary';
    summary.append(folderIcon());
    const name = document.createElement('span');
    name.className = 'sidebar-project-name';
    name.textContent = project.name;
    summary.append(name, chevronIcon());

    const body = document.createElement('div');
    body.className = 'sidebar-project-body';
    const history = document.createElement('div');
    history.className = 'sidebar-project-history';
    const loading = document.createElement('span');
    loading.className = 'sidebar-project-history-empty';
    loading.textContent = copy().loading;
    history.append(loading);

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'sidebar-project-more-history';
    more.textContent = copy().moreHistory;
    more.hidden = true;

    const state = { loaded: false, loading: false, cursor: '', hasMore: true };
    details.addEventListener('toggle', () => {
      if (details.open && !state.loaded) void loadHistory(project.id, history, more, state);
    });
    more.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void loadHistory(project.id, history, more, state);
    });

    body.append(history, more);
    details.append(summary, body);
    return details;
  }

  function moveAboutLink(sidebar) {
    if (!(sidebar instanceof HTMLElement)) return;
    const nav = sidebar.querySelector('.platform-nav');
    if (!(nav instanceof HTMLElement)) return;
    const newPage = nav.querySelector('a[href="/app/new"]');
    const about = sidebar.querySelector('a[href="/app/about"]');
    if (!(newPage instanceof HTMLElement) || !(about instanceof HTMLElement)) return;
    if (newPage.nextElementSibling === about) return;
    newPage.after(about);
  }

  function install(sidebar) {
    if (!(sidebar instanceof HTMLElement)) return;
    moveAboutLink(sidebar);
    if (sidebar.querySelector('[data-sidebar-project-section]')) return;
    const nav = sidebar.querySelector('.platform-nav');
    if (!(nav instanceof HTMLElement)) return;
    const developer = nav.querySelector('a[href="/app/developer"]');
    if (!(developer instanceof HTMLElement)) return;

    const legacyProject = nav.querySelector('a[href="/app/projects"]');
    if (legacyProject instanceof HTMLElement) legacyProject.hidden = true;

    const section = document.createElement('section');
    section.className = 'sidebar-project-section';
    section.dataset.sidebarProjectSection = 'true';

    const heading = document.createElement('a');
    heading.className = 'sidebar-project-heading';
    heading.href = '/app/projects';
    heading.setAttribute('aria-label', copy().openProject);
    if (legacyProject?.getAttribute('aria-current') === 'page') heading.setAttribute('aria-current', 'page');
    const headingText = document.createElement('span');
    headingText.textContent = copy().projects;
    heading.append(headingText);

    const list = document.createElement('div');
    list.className = 'sidebar-project-list';
    const state = document.createElement('span');
    state.className = 'sidebar-project-state';
    state.textContent = copy().loading;
    list.append(state);

    const moreProjects = document.createElement('button');
    moreProjects.type = 'button';
    moreProjects.className = 'sidebar-project-more-projects';
    moreProjects.textContent = copy().moreProjects;
    moreProjects.hidden = true;

    section.append(heading, list, moreProjects);
    developer.after(section);

    let visibleCount = PROJECT_BATCH;
    loadProjects().then((projects) => {
      if (!section.isConnected) return;
      const render = () => {
        list.replaceChildren();
        const visible = projects.slice(0, visibleCount);
        if (!visible.length) {
          const empty = document.createElement('span');
          empty.className = 'sidebar-project-state';
          empty.textContent = copy().empty;
          list.append(empty);
        } else {
          visible.forEach((project) => list.append(createProjectItem(project)));
        }
        moreProjects.hidden = visibleCount >= projects.length;
      };
      moreProjects.addEventListener('click', () => {
        visibleCount += PROJECT_BATCH;
        render();
      });
      render();
    });
  }

  function refresh() {
    refreshQueued = false;
    document.querySelectorAll('.platform-sidebar, .platform-mobile-drawer').forEach(install);
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(refresh);
  }

  refresh();
  new MutationObserver(scheduleRefresh).observe(document.documentElement, { childList: true, subtree: true });
})();
