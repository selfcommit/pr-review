import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { isNativeApp } from './platform';

const CUSTOM_SCHEME = 'com.prreview.app';
const NATIVE_CALLBACK_URL = `${CUSTOM_SCHEME}://auth/callback`;

let appUrlListener: (() => void) | null = null;

export function getNativeRedirectUrl(): string {
  return NATIVE_CALLBACK_URL;
}

export async function openNativeOAuth(url: string): Promise<void> {
  await Browser.open({ url, windowName: '_self' });
}

export function listenForAuthCallback(
  onCallback: (params: URLSearchParams) => void,
): () => void {
  if (appUrlListener) {
    appUrlListener();
    appUrlListener = null;
  }

  const listener = App.addListener('appUrlOpen', (event) => {
    const url = event.url;
    if (!url.startsWith(CUSTOM_SCHEME + '://')) return;

    Browser.close().catch(() => {});

    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return;

    const hash = url.substring(hashIndex + 1);
    const params = new URLSearchParams(hash);
    onCallback(params);
  });

  appUrlListener = () => {
    listener.then(h => h.remove());
  };

  return () => {
    if (appUrlListener) {
      appUrlListener();
      appUrlListener = null;
    }
  };
}

export function shouldUseNativeAuth(): boolean {
  return isNativeApp();
}
