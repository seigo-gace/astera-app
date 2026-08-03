import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

export function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativeCallback(path: string): string | undefined {
  if (!isNativeRuntime()) return undefined;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.startsWith('//') || normalized.includes('\\')) {
    throw new Error('ASTERA_NATIVE_CALLBACK_PATH_REJECTED');
  }
  return `jp.asterav8.app://open${normalized}`;
}

export async function openExternalUrl(rawUrl: string): Promise<void> {
  const destination = new URL(rawUrl, window.location.origin);
  if (destination.protocol !== 'https:') {
    throw new Error('ASTERA_EXTERNAL_URL_REQUIRES_HTTPS');
  }

  if (isNativeRuntime()) {
    await Browser.open({ url: destination.toString() });
    return;
  }

  window.location.assign(destination.toString());
}
