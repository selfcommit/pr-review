import { useEffect, useState } from 'react'

interface NotificationToastProps {
  messages: Array<{ prId: number; text: string }>
  onDismiss: () => void
  onClickPR: (prId: number) => void
}

function NotificationToast({ messages, onDismiss, onClickPR }: NotificationToastProps) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true)
      setTimeout(onDismiss, 300)
    }, 8000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  const handleClick = () => {
    if (messages.length > 0) {
      onClickPR(messages[0].prId)
    }
    setExiting(true)
    setTimeout(onDismiss, 300)
  }

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation()
    setExiting(true)
    setTimeout(onDismiss, 300)
  }

  const firstMsg = messages[0]?.text || ''
  const remaining = messages.length - 1

  return (
    <div
      className={`notification-toast ${exiting ? 'notification-toast-exit' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <div className="notification-toast-icon">
        <svg viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
        </svg>
      </div>
      <div className="notification-toast-body">
        <div className="notification-toast-title">
          {messages.length === 1 ? 'New review request' : `${messages.length} review requests need attention`}
        </div>
        <div className="notification-toast-text">
          {firstMsg}
          {remaining > 0 && <span className="notification-toast-more"> +{remaining} more</span>}
        </div>
      </div>
      <button className="notification-toast-close" onClick={handleDismiss} aria-label="Dismiss">
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.749.749 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.749.749 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </div>
  )
}

export default NotificationToast
