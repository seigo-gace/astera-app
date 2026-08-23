const TOGGLE_ID = 'astera-header-view-toggle';
const RESULT_PATH = /^\/app\/results\/[^/]+\/?$/;

function sourcePanel(): HTMLElement | null {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('.platform-panel > header, .platform-panel h2, .platform-panel strong'));
  const heading = headings.find((node) => (node.textContent || '').includes('Source / 根拠'));
  return heading?.closest<HTMLElement>('.platform-panel') ?? null;
}

function setActive(toggle: HTMLElement, view: 'main' | 'evidence'): void {
  toggle.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function buildToggle(): HTMLElement {
  const group = document.createElement('div');
  group.id = TOGGLE_ID;
  group.className = 'platform-main-evidence-toggle';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Mainページと根拠一覧の切替');

  const main = document.createElement('button');
  main.type = 'button';
  main.dataset.view = 'main';
  main.textContent = 'Main';
  main.setAttribute('aria-label', 'Mainページ');
  main.addEventListener('click', () => {
    if (window.location.pathname === '/app' || window.location.pathname === '/app/new') {
      setActive(group, 'main');
      return;
    }
    window.location.assign('/app/new');
  });

  const evidence = document.createElement('button');
  evidence.type = 'button';
  evidence.dataset.view = 'evidence';
  evidence.textContent = '根拠一覧';
  evidence.setAttribute('aria-label', '根拠一覧');
  evidence.addEventListener('click', () => {
    if (!RESULT_PATH.test(window.location.pathname)) return;
    const panel = sourcePanel();
    if (!panel) return;
    panel.id = 'result-sources';
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}#result-sources`);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(group, 'evidence');
  });

  group.append(main, evidence);
  return group;
}

function mountToggle(): boolean {
  const actions = document.querySelector<HTMLElement>('.platform-mobile-account-actions');
  const ai = actions?.querySelector<HTMLElement>('.platform-header-ai');
  if (!actions || !ai) return false;

  let toggle = document.getElementById(TOGGLE_ID) as HTMLElement | null;
  if (!toggle) {
    toggle = buildToggle();
    ai.insertAdjacentElement('afterend', toggle);
  } else if (toggle.parentElement !== actions || toggle.previousElementSibling !== ai) {
    ai.insertAdjacentElement('afterend', toggle);
  }

  const resultRoute = RESULT_PATH.test(window.location.pathname);
  const evidenceButton = toggle.querySelector<HTMLButtonElement>('button[data-view="evidence"]');
  if (evidenceButton) {
    evidenceButton.disabled = !resultRoute;
    evidenceButton.setAttribute('aria-disabled', resultRoute ? 'false' : 'true');
    evidenceButton.title = resultRoute ? '根拠一覧を表示' : 'Result表示時に利用できます';
  }
  setActive(toggle, resultRoute && window.location.hash === '#result-sources' ? 'evidence' : 'main');
  return true;
}

export function initializeHeaderViewToggle(): void {
  if (!window.location.pathname.startsWith('/app')) return;
  if (mountToggle()) return;

  const observer = new MutationObserver(() => {
    if (!mountToggle()) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
