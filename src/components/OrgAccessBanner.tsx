import { useState } from 'react'
import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrgAccessBannerProps {
  orgAccess: OrgAccessResult
  onReauthorize: () => void
  reauthorizing: boolean
}

function OrgAccessBanner({ orgAccess, onReauthorize, reauthorizing }: OrgAccessBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || orgAccess.loading) return null

  const hasRestrictedOrgs = orgAccess.restrictedOrgs.length > 0
  const missingScopes = orgAccess.oauthScopes !== null && (
    !orgAccess.oauthScopes.includes('repo') ||
    !orgAccess.oauthScopes.includes('read:org')
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
          {missingScopes && (
            <p className="org-access-banner-text">
              <strong>Missing permissions:</strong> Your token is missing required scopes ({orgAccess.oauthScopes}).
              Re-authorize to grant the necessary access.
            </p>
          )}
          {hasRestrictedOrgs && (
            <>
              <p className="org-access-banner-text">
                <strong>Organization access restricted:</strong> The following organizations may be blocking this app
                from accessing their repositories:
              </p>
              <div className="org-access-restricted-list">
                {orgAccess.restrictedOrgs.map(org => (
                  <a
                    key={org}
                    href={`https://github.com/organizations/${org}/settings/oauth_application_policy`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="org-access-restricted-item"
                  >
                    {org}
                    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                      <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-2.19l5.72 5.72a.75.75 0 1 1-1.06 1.06L4 4.56v2.19a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 3.25 2.5h.5zm5.5 7a.75.75 0 0 1 .75-.75h3.25a.75.75 0 0 1 .75.75v4.25a.75.75 0 0 1-.75.75H4.75a.75.75 0 0 1-.75-.75V9.75a.75.75 0 0 1 1.5 0v2.75h7V9.75a.75.75 0 0 1-.75-.75z"/>
                    </svg>
                  </a>
                ))}
              </div>
              <p className="org-access-banner-hint">
                An org admin needs to approve this app in the organization's settings.
                After approval, click "Re-authorize" to refresh your access.
              </p>
            </>
          )}
          <button
            className="org-access-reauth-button"
            onClick={onReauthorize}
            disabled={reauthorizing}
          >
            {reauthorizing ? 'Redirecting...' : 'Re-authorize with GitHub'}
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
