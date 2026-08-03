const root = document.documentElement;
let scheduledFrame = 0;
let initialized = false;

function viewportSize(): { width: number; height: number; offsetTop: number } {
  const viewport = window.visualViewport;
  return {
    width: Math.max(240, Math.round(viewport?.width ?? window.innerWidth)),
    height: Math.max(320, Math.round(viewport?.height ?? window.innerHeight)),
    offsetTop: Math.max(0, Math.round(viewport?.offsetTop ?? 0)),
  };
}

function viewportClass(width: number): 'compact' | 'mobile' | 'tablet' | 'desktop' {
  if (width <= 420) return 'compact';
  if (width <= 760) return 'mobile';
  if (width <= 1100) return 'tablet';
  return 'desktop';
}

function applyCapabilities(): void {
  scheduledFrame = 0;
  const size = viewportSize();
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hoverAvailable = window.matchMedia('(hover: hover)').matches;
  const landscape = size.width > size.height;

  root.style.setProperty('--app-viewport-height', `${size.height}px`);
  root.style.setProperty('--app-viewport-width', `${size.width}px`);
  root.style.setProperty('--app-viewport-offset-top', `${size.offsetTop}px`);
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
  if ('addEventListener' in query) {
    query.addEventListener('change', scheduleCapabilities);
    return;
  }
  query.addListener(scheduleCapabilities);
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
