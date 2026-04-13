import { useState } from 'react'
import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrgAccessBannerProps {
  orgAccess: OrgAccessResult
  installUrl: string | null
  onSwitchToOrgsTab: () => void
}

function OrgAccessBanner({ orgAccess, installUrl, onSwitchToOrgsTab }: OrgAccessBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || orgAccess.loading) return null

  const hasRestrictedOrgs = orgAccess.restrictedOrgs.length > 0
  const hasVisibleOrgs = orgAccess.memberOrgs.length > 0

  if (!hasRestrictedOrgs && hasVisibleOrgs) return null

  let bannerText: JSX.Element
  if (hasRestrictedOrgs) {
    bannerText = (
      <p className="org-access-banner-text">
        <strong>{orgAccess.restrictedOrgs.length} organization{orgAccess.restrictedOrgs.length !== 1 ? 's need' : ' needs'} the app installed.</strong>{' '}
        Some private PRs may be hidden.
      </p>
    )
  } else {
    bannerText = (
      <p className="org-access-banner-text">
        <strong>No organizations connected.</strong>{' '}
        Install the app on your GitHub organizations to see private PRs.
      </p>
    )
  }

  return (
    <div className="org-access-banner">
      <div className="org-access-banner-content">
        <div className="org-access-banner-icon">
          <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="org-access-banner-body">
          {bannerText}
          {installUrl ? (
            <a
              href={installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="org-access-banner-link"
            >
              Install on GitHub
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm7.25-.75a.75.75 0 01.75-.75h3.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V6.31l-5.47 5.47a.75.75 0 11-1.06-1.06l5.47-5.47H12.25a.75.75 0 01-.75-.75z" clipRule="evenodd" />
              </svg>
            </a>
          ) : (
            <button className="org-access-banner-link" onClick={onSwitchToOrgsTab}>
              View Organizations
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
        <button
          className="org-access-banner-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  )
}

export default OrgAccessBanner
