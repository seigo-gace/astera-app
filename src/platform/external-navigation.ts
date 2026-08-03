import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

export function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
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
