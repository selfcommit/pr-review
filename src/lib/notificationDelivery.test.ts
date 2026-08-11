import { describe, it, expect } from 'vitest'
import { selectNotificationChannel, describePermissionStatus } from './notificationDelivery'

describe('selectNotificationChannel', () => {
  it('picks the service worker channel whenever it is available and permission is granted', () => {
    expect(
      selectNotificationChannel({
        supportsNotifications: true,
        permission: 'granted',
        desktopEnabled: true,
        serviceWorkerAvailable: true,
      }),
    ).toBe('service-worker')
  })

  it('falls back to plain notifications when no service worker is available', () => {
    expect(
      selectNotificationChannel({
        supportsNotifications: true,
        permission: 'granted',
        desktopEnabled: true,
        serviceWorkerAvailable: false,
      }),
    ).toBe('plain')
  })

  it('does not deliver anything when the user turned desktop notifications off', () => {
    expect(
      selectNotificationChannel({
        supportsNotifications: true,
        permission: 'granted',
        desktopEnabled: false,
        serviceWorkerAvailable: true,
      }),
    ).toBe('none')
  })

  it('does not deliver anything when the browser blocked the site', () => {
    expect(
      selectNotificationChannel({
        supportsNotifications: true,
        permission: 'denied',
        desktopEnabled: true,
        serviceWorkerAvailable: true,
      }),
    ).toBe('none')
  })

  it('does not deliver anything when the browser has not been asked yet', () => {
    expect(
      selectNotificationChannel({
        supportsNotifications: true,
        permission: 'default',
        desktopEnabled: true,
        serviceWorkerAvailable: true,
      }),
    ).toBe('none')
  })

  it('does not deliver anything when the browser lacks the Notification API entirely', () => {
    expect(
      selectNotificationChannel({
        supportsNotifications: false,
        permission: 'granted',
        desktopEnabled: true,
        serviceWorkerAvailable: true,
      }),
    ).toBe('none')
  })
})

describe('describePermissionStatus', () => {
  it('reports "on" when the browser has granted permission', () => {
    expect(describePermissionStatus({ supported: true, permission: 'granted' })).toEqual({
      label: 'Desktop notifications: on',
      tone: 'ok',
    })
  })

  it('reports "blocked" when the browser has denied permission', () => {
    expect(describePermissionStatus({ supported: true, permission: 'denied' })).toEqual({
      label: 'Desktop notifications: blocked in browser settings',
      tone: 'error',
    })
  })

  it('reports "not enabled" when the user has not been asked yet', () => {
    expect(describePermissionStatus({ supported: true, permission: 'default' })).toEqual({
      label: 'Desktop notifications: not enabled',
      tone: 'warn',
    })
  })

  it('reports "not supported" when the browser has no Notification API', () => {
    expect(describePermissionStatus({ supported: false, permission: null })).toEqual({
      label: 'Desktop notifications: not supported by this browser',
      tone: 'warn',
    })
  })
})
