import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

const ASTERA_APP_HOST = 'app.asterav8.jp';

function safeFileName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return normalized || 'Astera-response.md';
}

async function shareBlobDownload(anchor: HTMLAnchorElement): Promise<void> {
  const response = await fetch(anchor.href);
  const content = await response.text();
  const fileName = safeFileName(anchor.download || 'Astera-response.md');
  const result = await Filesystem.writeFile({
    path: fileName,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  await Share.share({
    title: fileName,
    text: 'Asteraの回答を保存または共有します。',
    files: [result.uri],
    dialogTitle: 'Asteraの回答を保存・共有',
  });
}

function installNativeDownloadBridge(): void {
  const originalClick = HTMLAnchorElement.prototype.click;

  HTMLAnchorElement.prototype.click = function asteraNativeAnchorClick(): void {
    if (this.download && this.href.startsWith('blob:')) {
      void shareBlobDownload(this).catch((error: unknown) => {
        console.error('ASTERA_NATIVE_EXPORT_FAILED', error);
      });
      return;
    }

    originalClick.call(this);
  };
}

function installExternalLinkBridge(): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.download) return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || (!rawHref.startsWith('https://') && !rawHref.startsWith('http://'))) return;

      event.preventDefault();
      void Browser.open({ url: anchor.href }).catch((error: unknown) => {
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
    try {
      const parsed = new URL(url);
      const isAsteraUniversalLink = parsed.hostname === ASTERA_APP_HOST;
      const isAsteraCustomScheme = parsed.protocol === 'jp.asterav8.app:';
      if (!isAsteraUniversalLink && !isAsteraCustomScheme) return;

      window.location.assign(`${parsed.pathname}${parsed.search}${parsed.hash}` || '/');
    } catch (error) {
      console.error('ASTERA_NATIVE_DEEP_LINK_FAILED', error);
    }
  });
}

export async function initializeNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

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
