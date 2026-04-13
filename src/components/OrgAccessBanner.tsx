import { useState } from 'react'
import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrgAccessBannerProps {
  orgAccess: OrgAccessResult
  onSwitchToOrgsTab: () => void
}

function OrgAccessBanner({ orgAccess, onSwitchToOrgsTab }: OrgAccessBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || orgAccess.loading) return null

  const hasRestrictedOrgs = orgAccess.restrictedOrgs.length > 0
  const scopeString = orgAccess.oauthScopes
  const missingScopes = scopeString !== null && (
    !scopeString.includes('repo') ||
    !scopeString.includes('read:org')
  )
  const hasVisibleOrgs = orgAccess.memberOrgs.length > 0

  if (!hasRestrictedOrgs && !missingScopes && hasVisibleOrgs) return null

  let bannerText: JSX.Element
  if (missingScopes) {
    bannerText = (
      <p className="org-access-banner-text">
        <strong>Missing permissions:</strong> Your token is missing required scopes.
        Check the Organizations tab to re-authorize.
      </p>
    )
  } else if (hasRestrictedOrgs) {
    bannerText = (
      <p className="org-access-banner-text">
        <strong>{orgAccess.restrictedOrgs.length} organization{orgAccess.restrictedOrgs.length !== 1 ? 's need' : ' needs'} access approval.</strong>{' '}
        Some private PRs may be hidden.
      </p>
    )
  } else {
    bannerText = (
      <p className="org-access-banner-text">
        <strong>Private organizations may be hidden.</strong>{' '}
        GitHub hides orgs with access restrictions until you grant this app permission.
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
          <button className="org-access-banner-link" onClick={onSwitchToOrgsTab}>
            Manage Organizations
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
            </svg>
          </button>
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
