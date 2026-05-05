import { useEffect, useState } from 'react'
import { useProfileVisibility } from '../hooks/useProfileVisibility'

const STORAGE_KEY = 'public_profile_announced_v1'

export function PublicProfileAnnouncement() {
  const { settings } = useProfileVisibility()
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === '1')
  }, [])

  if (dismissed || !settings) return null

  const profileUrl = `${window.location.origin}/u/${settings.login}`

  const markAcknowledged = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="public-profile-announcement" role="status">
      <div className="public-profile-announcement-body">
        <div className="public-profile-announcement-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </div>
        <div className="public-profile-announcement-text">
          <strong>Your review stats now have a public profile.</strong>
          <span>
            Share <code className="public-profile-announcement-url">{profileUrl}</code> with teammates, or keep it private.
          </span>
        </div>
      </div>
      <div className="public-profile-announcement-actions">
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="public-profile-announcement-btn public-profile-announcement-btn--primary"
          onClick={markAcknowledged}
        >
          View my profile
        </a>
        <button
          type="button"
          onClick={markAcknowledged}
          className="public-profile-announcement-dismiss"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  )
}
