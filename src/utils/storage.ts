import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './platform';

export async function getItem(key: string): Promise<string | null> {
  if (isNativeApp()) {
    const { value } = await Preferences.get({ key });
    return value;
  }
  return localStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isNativeApp()) {
    await Preferences.set({ key, value });
  } else {
    localStorage.setItem(key, value);
  }
}

export async function removeItem(key: string): Promise<void> {
  if (isNativeApp()) {
    await Preferences.remove({ key });
  } else {
    localStorage.removeItem(key);
  }
}

export function getItemSync(key: string): string | null {
  return localStorage.getItem(key);
}

export function setItemSync(key: string, value: string): void {
  localStorage.setItem(key, value);
}

export function removeItemSync(key: string): void {
  localStorage.removeItem(key);
}
