import { isNativeApp } from './platform'
import {
  selectNotificationChannel,
  NotificationChannel,
} from '../lib/notificationDelivery'

const SW_URL = '/notification-sw.js'
const ICON_URL = 'https://github.githubassets.com/favicons/favicon-dark.svg'

let swRegistration: ServiceWorkerRegistration | null = null
let swRegisterPromise: Promise<ServiceWorkerRegistration | null> | null = null
const clickHandlers = new Map<string, () => void>()
let messageListenerAttached = false

function ensureMessageListener() {
  if (messageListenerAttached) return
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  navigator.serviceWorker.addEventListener('message', event => {
    const payload = event.data
    if (!payload || payload.type !== 'notification-click') return
    const tag: string | null = payload.tag ?? null
    if (!tag) return
    const handler = clickHandlers.get(tag)
    if (handler) {
      clickHandlers.delete(tag)
      try {
        handler()
      } catch {
        // handler threw; ignore
      }
    }
  })
  messageListenerAttached = true
}

export function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (swRegisterPromise) return swRegisterPromise
  if (isNativeApp() || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    swRegisterPromise = Promise.resolve(null)
    return swRegisterPromise
  }
  ensureMessageListener()
  swRegisterPromise = navigator.serviceWorker
    .register(SW_URL)
    .then(reg => {
      swRegistration = reg
      return reg
    })
    .catch(() => null)
  return swRegisterPromise
}

// Ask the browser for notification permission AND kick off the service worker
// registration. Both consume a browser user-activation budget, so this must
// only be called from a real user gesture — never at page mount, or it races
// with the readiness-chime autoplay attempt and silences it.
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (isNativeApp()) return null
  if (!('Notification' in window)) return null
  void registerNotificationServiceWorker()
  if (Notification.permission === 'default') {
    try {
      return await Notification.requestPermission()
    } catch {
      return Notification.permission
    }
  }
  return Notification.permission
}

export function getNotificationPermission(): NotificationPermission | null {
  if (typeof window === 'undefined') return null
  if (!('Notification' in window)) return null
  return Notification.permission
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export interface SendBrowserNotificationOptions {
  desktopEnabled?: boolean
  onDelivered?: (channel: NotificationChannel) => void
}

export function sendBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void,
  tag?: string,
  silent?: boolean,
  options: SendBrowserNotificationOptions = {},
): NotificationChannel {
  if (isNativeApp()) return 'none'
  if (!('Notification' in window)) return 'none'

  const channel = selectNotificationChannel({
    supportsNotifications: true,
    permission: Notification.permission,
    desktopEnabled: options.desktopEnabled !== false,
    serviceWorkerAvailable: !!swRegistration,
  })

  if (channel === 'none') return 'none'

  const notificationTag = tag ?? `pr-${Date.now()}`

  if (channel === 'service-worker' && swRegistration) {
    if (onClick) clickHandlers.set(notificationTag, onClick)
    swRegistration
      .showNotification(title, {
        body,
        icon: ICON_URL,
        tag: notificationTag,
        requireInteraction: true,
        silent: silent === true ? true : silent === false ? false : undefined,
        data: { tag: notificationTag },
      })
      .then(() => options.onDelivered?.('service-worker'))
      .catch(() => {
        clickHandlers.delete(notificationTag)
      })
    return 'service-worker'
  }

  try {
    const opts: NotificationOptions = {
      body,
      icon: ICON_URL,
      tag: notificationTag,
    }
    if (silent === true) opts.silent = true
    else if (silent === false) opts.silent = false

    const notification = new Notification(title, opts)
    notification.onclick = () => {
      window.focus()
      notification.close()
      onClick?.()
    }
    setTimeout(() => notification.close(), 12000)
    options.onDelivered?.('plain')
    return 'plain'
  } catch {
    return 'none'
  }
}
