const root = document.documentElement;
let scheduledFrame = 0;
let initialized = false;
let lastLayoutWidth = 0;
let lastViewportHeight = 0;
let lastViewportOffsetTop = 0;
let lastScrollbarWidth = -1;

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

function applyCapabilities(): void {
  scheduledFrame = 0;
  const size = viewportSize();
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hoverAvailable = window.matchMedia('(hover: hover)').matches;
  const landscape = size.width > size.height;

  if (size.width !== lastLayoutWidth) {
    lastLayoutWidth = setPixelVariable('--app-layout-width', size.width, lastLayoutWidth);
    root.style.setProperty('--app-viewport-width', `${size.width}px`);
  }
  lastViewportHeight = setPixelVariable('--app-viewport-height', size.height, lastViewportHeight);
  lastViewportOffsetTop = setPixelVariable('--app-viewport-offset-top', size.offsetTop, lastViewportOffsetTop);
  lastScrollbarWidth = setPixelVariable('--app-scrollbar-width', size.scrollbarWidth, lastScrollbarWidth);
  root.dataset.asteraViewport = viewportClass(size.width);
  root.dataset.asteraOrientation = landscape ? 'landscape' : 'portrait';
  root.classList.toggle('astera-touch', coarsePointer);
  root.classList.toggle('astera-hoverless', !hoverAvailable);
  root.classList.toggle('astera-short-viewport', size.height <= 560);
}

function scheduleCapabilities(): void {
  if (scheduledFrame) return;
  scheduledFrame = window.requestAnimationFrame(applyCapabilities);
}

function observeMedia(query: MediaQueryList): void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', scheduleCapabilities);
    return;
  }

  const legacyQuery = query as MediaQueryList & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  };
  legacyQuery.addListener?.(scheduleCapabilities);
}

export function initializeDeviceCompatibility(): void {
  if (initialized) return;
  initialized = true;
  root.dataset.asteraDeviceCompatibility = 'ready';

  applyCapabilities();
  window.addEventListener('resize', scheduleCapabilities, { passive: true });
  window.addEventListener('orientationchange', scheduleCapabilities, { passive: true });
  window.addEventListener('pageshow', scheduleCapabilities, { passive: true });
  document.addEventListener('visibilitychange', scheduleCapabilities, { passive: true });

  window.visualViewport?.addEventListener('resize', scheduleCapabilities, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleCapabilities, { passive: true });
  observeMedia(window.matchMedia('(pointer: coarse)'));
  observeMedia(window.matchMedia('(hover: hover)'));
}
