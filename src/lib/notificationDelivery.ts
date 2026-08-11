export type NotificationChannel = 'service-worker' | 'plain' | 'none'

export interface NotificationDeliveryInputs {
  supportsNotifications: boolean
  permission: NotificationPermission | null
  desktopEnabled: boolean
  serviceWorkerAvailable: boolean
}

// Pick the delivery channel for a desktop notification. The service-worker
// channel is preferred because plain page-level notifications are silently
// suppressed on desktop Chrome and Edge whenever the tab is focused.
export function selectNotificationChannel(
  inputs: NotificationDeliveryInputs,
): NotificationChannel {
  if (!inputs.supportsNotifications) return 'none'
  if (!inputs.desktopEnabled) return 'none'
  if (inputs.permission !== 'granted') return 'none'
  if (inputs.serviceWorkerAvailable) return 'service-worker'
  return 'plain'
}

export interface PermissionStatus {
  supported: boolean
  permission: NotificationPermission | null
}

export function describePermissionStatus(status: PermissionStatus): {
  label: string
  tone: 'ok' | 'warn' | 'error'
} {
  if (!status.supported) {
    return { label: 'Desktop notifications: not supported by this browser', tone: 'warn' }
  }
  if (status.permission === 'granted') {
    return { label: 'Desktop notifications: on', tone: 'ok' }
  }
  if (status.permission === 'denied') {
    return { label: 'Desktop notifications: blocked in browser settings', tone: 'error' }
  }
  return { label: 'Desktop notifications: not enabled', tone: 'warn' }
}
