export function requestNotificationPermission(): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

export function sendBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void
): void {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return

  try {
    const notification = new Notification(title, {
      body,
      icon: 'https://github.githubassets.com/favicons/favicon-dark.svg',
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
      onClick?.()
    }

    setTimeout(() => notification.close(), 8000)
  } catch {
    // browser blocked notification
  }
}
