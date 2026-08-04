const root = document.documentElement;
let scheduledFrame = 0;
let initialized = false;
let lastLayoutWidth = 0;
let lastViewportHeight = 0;
let lastViewportOffsetTop = 0;
let lastScrollbarWidth = -1;
let currentOrientation: AsteraOrientation | null = null;
let orientationSnapshot: ScrollSnapshot | null = null;
let orientationTimers: number[] = [];

type AsteraOrientation = 'portrait' | 'landscape';

type ScrollSnapshot = {
  windowY: number;
  entries: Array<{ element: HTMLElement; top: number }>;
};

const ORIENTATION_SCROLL_CONTAINERS = [
  '.timeline',
  '.platform-main',
  '.dialog-content',
  '.sidebar-scroll-viewport',
  '.platform-mobile-drawer',
] as const;

const TRANSIENT_NAVIGATION_BACKDROPS = [
  '.mobile-backdrop',
  '.platform-backdrop',
] as const;

function viewportSize(): { width: number; height: number; offsetTop: number; scrollbarWidth: number } {
  const viewport = window.visualViewport;
  const documentWidth = root.clientWidth || window.innerWidth;
  const layoutWidth = Math.max(240, Math.floor(documentWidth));
  const viewportHeight = Math.max(320, Math.floor(viewport?.height ?? window.innerHeight));
  const offsetTop = Math.max(0, Math.floor(viewport?.offsetTop ?? 0));
  const scrollbarWidth = Math.max(0, Math.round(window.innerWidth - documentWidth));

  return {
    width: layoutWidth,
    height: viewportHeight,
    offsetTop,
    scrollbarWidth,
  };
}

function orientationFromViewport(width: number, height: number): AsteraOrientation {
  return width > height ? 'landscape' : 'portrait';
}

function viewportClass(width: number): 'compact' | 'mobile' | 'tablet' | 'desktop' {
  if (width <= 420) return 'compact';
  if (width <= 760) return 'mobile';
  if (width <= 1100) return 'tablet';
  return 'desktop';
}

function setPixelVariable(name: string, value: number, previousValue: number): number {
  if (value === previousValue) return previousValue;
  root.style.setProperty(name, `${value}px`);
  return value;
}

function closeTransientNavigation(): void {
  for (const selector of TRANSIENT_NAVIGATION_BACKDROPS) {
    for (const backdrop of document.querySelectorAll<HTMLElement>(selector)) {
      backdrop.click();
    }
  }
}

function captureScrollSnapshot(): ScrollSnapshot {
  const entries = ORIENTATION_SCROLL_CONTAINERS.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => ({
      element,
      top: element.scrollTop,
    })),
  );

  return {
    windowY: window.scrollY,
    entries,
  };
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot): void {
  window.scrollTo({ top: snapshot.windowY, left: 0, behavior: 'auto' });
  root.scrollLeft = 0;
  document.body.scrollLeft = 0;

  for (const entry of snapshot.entries) {
    if (!entry.element.isConnected) continue;
    const maxTop = Math.max(0, entry.element.scrollHeight - entry.element.clientHeight);
    entry.element.scrollTo({
      top: Math.min(entry.top, maxTop),
      left: 0,
      behavior: 'auto',
    });
  }
}

function applyCapabilities(forcedOrientation?: AsteraOrientation): void {
  scheduledFrame = 0;
  const size = viewportSize();
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hoverAvailable = window.matchMedia('(hover: hover)').matches;
  const orientation = forcedOrientation ?? orientationFromViewport(size.width, size.height);

  if (size.width !== lastLayoutWidth) {
    lastLayoutWidth = setPixelVariable('--app-layout-width', size.width, lastLayoutWidth);
    root.style.setProperty('--app-viewport-width', `${size.width}px`);
  }
  lastViewportHeight = setPixelVariable('--app-viewport-height', size.height, lastViewportHeight);
  lastViewportOffsetTop = setPixelVariable('--app-viewport-offset-top', size.offsetTop, lastViewportOffsetTop);
  lastScrollbarWidth = setPixelVariable('--app-scrollbar-width', size.scrollbarWidth, lastScrollbarWidth);
  root.dataset.asteraViewport = viewportClass(size.width);
  root.dataset.asteraOrientation = orientation;
  root.classList.toggle('astera-touch', coarsePointer);
  root.classList.toggle('astera-hoverless', !hoverAvailable);
  root.classList.toggle('astera-short-viewport', size.height <= 560);
}

function scheduleCapabilities(): void {
  if (scheduledFrame) return;
  scheduledFrame = window.requestAnimationFrame(() => {
    const forcedOrientation = root.classList.contains('astera-rotating')
      ? currentOrientation ?? undefined
      : undefined;
    applyCapabilities(forcedOrientation);
  });
}

function clearOrientationTimers(): void {
  for (const timer of orientationTimers) window.clearTimeout(timer);
  orientationTimers = [];
}

function beginOrientationTransition(nextOrientation: AsteraOrientation): void {
  if (nextOrientation === currentOrientation) {
    scheduleCapabilities();
    return;
  }

  const previousOrientation = currentOrientation ?? nextOrientation;
  clearOrientationTimers();
  closeTransientNavigation();
  orientationSnapshot = captureScrollSnapshot();
  currentOrientation = nextOrientation;
  root.classList.add('astera-rotating');
  root.dataset.asteraOrientation = nextOrientation;

  window.dispatchEvent(new CustomEvent('astera:orientationchange', {
    detail: {
      previous: previousOrientation,
      current: nextOrientation,
    },
  }));

  const settleDelays = [0, 80, 180, 360];
  orientationTimers = settleDelays.map((delay, index) => window.setTimeout(() => {
    applyCapabilities(nextOrientation);
    if (orientationSnapshot) restoreScrollSnapshot(orientationSnapshot);

    if (index === settleDelays.length - 1) {
      root.classList.remove('astera-rotating');
      orientationSnapshot = null;
      orientationTimers = [];
      window.dispatchEvent(new CustomEvent('astera:orientation-settled', {
        detail: { current: nextOrientation },
      }));
    }
  }, delay));
}

function observeMedia(
  query: MediaQueryList,
  listener: (event: MediaQueryListEvent) => void = scheduleCapabilities,
): void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return;
  }

  const legacyQuery = query as MediaQueryList & {
    addListener?: (legacyListener: (event: MediaQueryListEvent) => void) => void;
  };
  legacyQuery.addListener?.(listener);
}

export function initializeDeviceCompatibility(): void {
  if (initialized) return;
  initialized = true;
  root.dataset.asteraDeviceCompatibility = 'ready';

  const initialSize = viewportSize();
  currentOrientation = orientationFromViewport(initialSize.width, initialSize.height);
  applyCapabilities(currentOrientation);

  window.addEventListener('resize', scheduleCapabilities, { passive: true });
  window.addEventListener('pageshow', scheduleCapabilities, { passive: true });
  document.addEventListener('visibilitychange', scheduleCapabilities, { passive: true });

  window.visualViewport?.addEventListener('resize', scheduleCapabilities, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleCapabilities, { passive: true });
  observeMedia(window.matchMedia('(pointer: coarse)'));
  observeMedia(window.matchMedia('(hover: hover)'));
  observeMedia(window.matchMedia('(orientation: landscape)'), (event) => {
    beginOrientationTransition(event.matches ? 'landscape' : 'portrait');
  });
  window.addEventListener('orientationchange', () => {
    const landscape = window.matchMedia('(orientation: landscape)').matches;
    beginOrientationTransition(landscape ? 'landscape' : 'portrait');
  }, { passive: true });
}
