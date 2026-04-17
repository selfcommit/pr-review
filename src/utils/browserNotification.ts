export function requestNotificationPermission(): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {})
  }
}

export function sendBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void,
  tag?: string,
  silent?: boolean
): void {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    const options: NotificationOptions = {
      body,
      icon: 'https://github.githubassets.com/favicons/favicon-dark.svg',
      tag,
    }

    if (silent === true) {
      options.silent = true
    } else if (silent === false) {
      options.silent = false
    }

    const notification = new Notification(title, options)

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
