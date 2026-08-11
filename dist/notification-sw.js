// Service worker used purely for showing OS-level notifications.
// The main app registers this and calls registration.showNotification(...)
// so that notifications appear on the desktop even when the tab is focused,
// which plain page-level Notification() calls do not reliably do on Chrome
// or Edge desktop.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tag = event.notification.tag || null;
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of clientsList) {
      if ('focus' in client) {
        try {
          await client.focus();
        } catch (_) {}
        try {
          client.postMessage({ type: 'notification-click', tag, data });
        } catch (_) {}
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow('/');
    }
  })());
});
