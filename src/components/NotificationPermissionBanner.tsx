import { useState, useEffect } from 'react'
import { registerNotificationServiceWorker } from '../utils/browserNotification'

interface NotificationPermissionBannerProps {
  soundEnabled: boolean
}

const DISMISS_KEY = 'notification-banner-dismissed'

function NotificationPermissionBanner({ soundEnabled }: NotificationPermissionBannerProps) {
  const [visible, setVisible] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | null>(null)

  useEffect(() => {
    if (!('Notification' in window) || !soundEnabled) {
      setVisible(false)
      return
    }

    const perm = Notification.permission
    setPermission(perm)

    if (perm === 'granted') {
      setVisible(false)
      return
    }

    try {
      const dismissed = sessionStorage.getItem(DISMISS_KEY)
      if (dismissed === 'true') {
        setVisible(false)
        return
      }
    } catch {}

    setVisible(true)
  }, [soundEnabled])

  const handleEnable = async () => {
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') {
        void registerNotificationServiceWorker()
        setVisible(false)
      }
    } catch {}
  }

  const handleDismiss = () => {
    setVisible(false)
    try {
      sessionStorage.setItem(DISMISS_KEY, 'true')
    } catch {}
  }

  if (!visible) return null

  const isDenied = permission === 'denied'

  return (
    <div className="notification-permission-banner">
      <div className="notification-permission-banner-content">
        <svg viewBox="0 0 16 16" fill="currentColor" width="18" height="18" className="notification-permission-banner-icon">
          <path d="M8 16a2 2 0 0 0 1.985-1.75H6.015A2 2 0 0 0 8 16ZM8 1.5A3.5 3.5 0 0 0 4.5 5c0 .655-.126 2.686-.834 4.25-.177.39-.354.75-.516 1.05a25 25 0 0 1-.35.6l-.058.091-.02.03-.005.007v.001L3.5 11.5h9l.783-.471-.005-.008-.02-.03a13 13 0 0 1-.408-.69 17 17 0 0 1-.516-1.051C11.626 7.686 11.5 5.655 11.5 5A3.5 3.5 0 0 0 8 1.5ZM3 12.5h10a1 1 0 0 0 .783-1.629 14 14 0 0 1-.448-.602 15.4 15.4 0 0 1-.468-.954C12.126 7.69 12 5.845 12 5a4 4 0 0 0-8 0c0 .845-.126 2.69-.867 4.315a15 15 0 0 1-.468.954 14 14 0 0 1-.448.602A1 1 0 0 0 3 12.5Z"/>
        </svg>
        <div className="notification-permission-banner-body">
          {isDenied ? (
            <p className="notification-permission-banner-text">
              Desktop notifications are <strong>blocked</strong>. To receive alerts for new review requests, enable notifications for this site in your browser settings.
            </p>
          ) : (
            <p className="notification-permission-banner-text">
              Enable desktop notifications to get alerted when new PRs need your review. Banners appear even while this tab is focused.
            </p>
          )}
        </div>
        {!isDenied && (
          <button className="notification-permission-banner-enable" onClick={handleEnable}>
            Enable
          </button>
        )}
        <button className="notification-permission-banner-dismiss" onClick={handleDismiss} aria-label="Dismiss">
          &times;
        </button>
      </div>
    </div>
  )
}

export default NotificationPermissionBanner
