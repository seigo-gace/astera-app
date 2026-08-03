import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

const ASTERA_APP_HOST = 'app.asterav8.jp';
const ASTERA_CUSTOM_SCHEME = 'jp.asterav8.app:';
const MAX_NATIVE_EXPORT_BYTES = 25 * 1024 * 1024;

function safeFileName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return normalized || 'Astera-response.md';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

async function shareBlobDownload(anchor: HTMLAnchorElement): Promise<void> {
  const response = await fetch(anchor.href);
  if (!response.ok) throw new Error(`ASTERA_NATIVE_EXPORT_HTTP_${response.status}`);

  const content = await response.arrayBuffer();
  if (content.byteLength > MAX_NATIVE_EXPORT_BYTES) {
    throw new Error('ASTERA_NATIVE_EXPORT_TOO_LARGE');
  }

  const fileName = safeFileName(anchor.download || 'Astera-response.md');
  const result = await Filesystem.writeFile({
    path: fileName,
    data: arrayBufferToBase64(content),
    directory: Directory.Cache,
    recursive: true,
  });

  await Share.share({
    title: fileName,
    text: 'Asteraの回答を保存または共有します。',
    files: [result.uri],
    dialogTitle: 'Asteraの回答を保存・共有',
  });
}

function installNativeDownloadBridge(): void {
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>('a[download][href]');
      if (!anchor || !anchor.href.startsWith('blob:')) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      void shareBlobDownload(anchor).catch((error: unknown) => {
        console.error('ASTERA_NATIVE_EXPORT_FAILED', error);
      });
    },
    true,
  );
}

function internalPathFromUrl(url: URL): string | null {
  if (url.protocol === 'https:' && url.hostname === ASTERA_APP_HOST) {
    return `${url.pathname}${url.search}${url.hash}` || '/';
  }

  if (url.protocol !== ASTERA_CUSTOM_SCHEME) return null;

  const hostSegment = url.hostname && url.hostname !== 'open' ? `/${url.hostname}` : '';
  const candidate = `${hostSegment}${url.pathname}${url.search}${url.hash}` || '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return null;
  return candidate;
}

function routeNativeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const internalPath = internalPathFromUrl(url);
    if (!internalPath) return false;

    window.location.assign(internalPath);
    return true;
  } catch (error) {
    console.error('ASTERA_NATIVE_DEEP_LINK_FAILED', error);
    return false;
  }
}

function installExternalLinkBridge(): void {
  document.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.download) return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || (!rawHref.startsWith('https://') && !rawHref.startsWith('http://'))) return;

      const destination = new URL(anchor.href);
      const internalPath = internalPathFromUrl(destination);
      if (internalPath) {
        event.preventDefault();
        window.location.assign(internalPath);
        return;
      }

      event.preventDefault();
      if (destination.protocol !== 'https:') {
        console.error('ASTERA_NATIVE_INSECURE_LINK_REJECTED', destination.toString());
        return;
      }

      void Browser.open({ url: destination.toString() }).catch((error: unknown) => {
        console.error('ASTERA_NATIVE_BROWSER_FAILED', error);
      });
    },
    true,
  );
}

async function syncStatusBar(): Promise<void> {
  const darkTheme = document.documentElement.dataset.theme !== 'light';

  await Promise.allSettled([
    StatusBar.setOverlaysWebView({ overlay: false }),
    StatusBar.setStyle({ style: darkTheme ? Style.Light : Style.Dark }),
    StatusBar.setBackgroundColor({ color: darkTheme ? '#0a0a0a' : '#f3efe8' }),
  ]);
}

function observeThemeForStatusBar(): void {
  const observer = new MutationObserver(() => {
    void syncStatusBar();
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper] [data-state="open"]',
    ),
  );
}

function closeTopOverlay(): boolean {
  if (!hasOpenOverlay()) return false;

  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

async function installAppLifecycleBridge(): Promise<void> {
  await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      activeElement.blur();
      void Keyboard.hide();
      return;
    }

    if (closeTopOverlay()) return;

    if (canGoBack) {
      window.history.back();
      return;
    }

    void CapacitorApp.exitApp();
  });

  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    routeNativeUrl(url);
  });

  const launchUrl = await CapacitorApp.getLaunchUrl();
  if (launchUrl?.url) routeNativeUrl(launchUrl.url);
}

export async function initializeNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (document.documentElement.dataset.asteraNativeShell === 'ready') return;
  document.documentElement.dataset.asteraNativeShell = 'ready';

  const platform = Capacitor.getPlatform();
  document.documentElement.classList.add('native-platform', `platform-${platform}`);

  installNativeDownloadBridge();
  installExternalLinkBridge();
  observeThemeForStatusBar();

  await Promise.allSettled([
    syncStatusBar(),
    Keyboard.setResizeMode({ mode: KeyboardResize.Body }),
    installAppLifecycleBridge(),
  ]);

  await SplashScreen.hide().catch(() => undefined);
}
