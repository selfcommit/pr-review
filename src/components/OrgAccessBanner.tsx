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

  if (!hasRestrictedOrgs && !missingScopes) return null

  return (
    <div className="org-access-banner">
      <div className="org-access-banner-content">
        <div className="org-access-banner-icon">
          <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="org-access-banner-body">
          {missingScopes ? (
            <p className="org-access-banner-text">
              <strong>Missing permissions:</strong> Your token is missing required scopes.
              Check the Organizations tab to re-authorize.
            </p>
          ) : (
            <p className="org-access-banner-text">
              <strong>{orgAccess.restrictedOrgs.length} organization{orgAccess.restrictedOrgs.length !== 1 ? 's need' : ' needs'} access approval.</strong>{' '}
              Some private PRs may be hidden.
            </p>
          )}
          <button className="org-access-banner-link" onClick={onSwitchToOrgsTab}>
            View Organizations
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
