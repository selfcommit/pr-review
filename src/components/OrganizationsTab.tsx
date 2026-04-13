import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrganizationsTabProps {
  orgAccess: OrgAccessResult
  onReauthorize: () => void
  reauthorizing: boolean
  reauthorizeError: string | null
}

function OrganizationsTab({ orgAccess, onReauthorize, reauthorizing, reauthorizeError }: OrganizationsTabProps) {
  const clientId = localStorage.getItem('github_client_id')

  const githubSettingsUrl = clientId
    ? `https://github.com/settings/connections/applications/${clientId}`
    : null

  const handleGrantAccess = (orgLogin: string) => {
    if (githubSettingsUrl) {
      window.open(githubSettingsUrl, '_blank', 'noopener,noreferrer')
    } else {
      window.open(
        `https://github.com/organizations/${orgLogin}/settings/oauth_application_policy`,
        '_blank',
        'noopener,noreferrer'
      )
    }
  }

  const handleOpenGitHubSettings = () => {
    if (githubSettingsUrl) {
      window.open(githubSettingsUrl, '_blank', 'noopener,noreferrer')
    } else {
      window.open('https://github.com/settings/applications', '_blank', 'noopener,noreferrer')
    }
  }

  if (orgAccess.loading) {
    return (
      <div className="orgs-tab-loading">
        <div className="spinner"></div>
        <p>Checking organization access...</p>
      </div>
    )
  }

  const connected = orgAccess.memberOrgs.filter(o => o.accessible)
  const restricted = orgAccess.memberOrgs.filter(o => !o.accessible)

  return (
    <div className="orgs-tab">
      {restricted.length > 0 && (
        <div className="orgs-tab-section">
          <div className="orgs-tab-section-header">
            <h2 className="orgs-tab-section-title orgs-tab-section-title-warning">
              Access Required
              <span className="orgs-tab-count orgs-tab-count-warning">{restricted.length}</span>
            </h2>
            <p className="orgs-tab-section-desc">
              These organizations have not granted this app access to their private repositories.
              {restricted.some(o => o.role === 'admin')
                ? ' As an admin, you can approve the app directly.'
                : ' An organization admin may need to approve the app.'}
            </p>
          </div>
          <div className="orgs-tab-list">
            {restricted.map(org => (
              <div key={org.login} className="orgs-tab-card orgs-tab-card-restricted">
                <div className="orgs-tab-card-left">
                  <img src={org.avatar_url} alt={org.login} className="orgs-tab-avatar" />
                  <div className="orgs-tab-card-info">
                    <span className="orgs-tab-card-name">{org.login}</span>
                    <span className="orgs-tab-card-role">{org.role === 'admin' ? 'Admin' : 'Member'}</span>
                  </div>
                </div>
                <div className="orgs-tab-card-right">
                  <span className="orgs-tab-status orgs-tab-status-restricted">Access Required</span>
                  <button
                    className="orgs-tab-grant-btn"
                    onClick={() => handleGrantAccess(org.login)}
                  >
                    Grant Access
                    <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                      <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-2.19l5.72 5.72a.75.75 0 1 1-1.06 1.06L4 4.56v2.19a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 3.25 2.5h.5z"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="orgs-tab-hint">
            <p>After granting access on GitHub, click below to refresh your token.</p>
            <button className="orgs-tab-reauth-btn" onClick={onReauthorize} disabled={reauthorizing}>
              {reauthorizing ? 'Redirecting...' : 'Re-authorize with GitHub'}
            </button>
            {reauthorizeError && (
              <div className="orgs-tab-reauth-error">
                <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>{reauthorizeError}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {connected.length > 0 && (
        <div className="orgs-tab-section">
          <div className="orgs-tab-section-header">
            <h2 className="orgs-tab-section-title orgs-tab-section-title-ok">
              Connected
              <span className="orgs-tab-count orgs-tab-count-ok">{connected.length}</span>
            </h2>
            <p className="orgs-tab-section-desc">
              These organizations have granted this app access. Private PRs from these orgs will appear in your dashboard.
            </p>
          </div>
          <div className="orgs-tab-list">
            {connected.map(org => (
              <div key={org.login} className="orgs-tab-card orgs-tab-card-connected">
                <div className="orgs-tab-card-left">
                  <img src={org.avatar_url} alt={org.login} className="orgs-tab-avatar" />
                  <div className="orgs-tab-card-info">
                    <span className="orgs-tab-card-name">{org.login}</span>
                    <span className="orgs-tab-card-role">{org.role === 'admin' ? 'Admin' : 'Member'}</span>
                  </div>
                </div>
                <div className="orgs-tab-card-right">
                  <span className="orgs-tab-status orgs-tab-status-connected">
                    <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
                    </svg>
                    Connected
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {orgAccess.memberOrgs.length === 0 && (
        <div className="orgs-tab-empty">
          <svg className="orgs-tab-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          <h2>No organizations visible</h2>
          <p>
            GitHub hides organizations that have third-party access restrictions enabled
            until you explicitly grant this app access. Use the steps below to add your orgs.
          </p>
        </div>
      )}

      <div className="orgs-tab-help">
        <div className="orgs-tab-help-header">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <h3>Not seeing an organization?</h3>
        </div>
        <p className="orgs-tab-help-desc">
          Private organizations with access restrictions will not appear here until access
          is explicitly granted. GitHub enforces this policy -- no app can bypass it.
        </p>
        <div className="orgs-tab-help-steps">
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">1</span>
            <div className="orgs-tab-help-step-text">
              <strong>Open your GitHub app permissions</strong>
              <span>Find the "Organization access" section on the settings page.</span>
            </div>
          </div>
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">2</span>
            <div className="orgs-tab-help-step-text">
              <strong>Click "Grant" next to each organization</strong>
              <span>If you see "Request" instead, your org admin must approve the app.</span>
            </div>
          </div>
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">3</span>
            <div className="orgs-tab-help-step-text">
              <strong>Come back here and re-authorize</strong>
              <span>This gives the app a fresh token that includes your newly granted orgs.</span>
            </div>
          </div>
        </div>
        <div className="orgs-tab-help-actions">
          <button className="orgs-tab-help-github-btn" onClick={handleOpenGitHubSettings}>
            <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            Open GitHub Settings
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-2.19l5.72 5.72a.75.75 0 1 1-1.06 1.06L4 4.56v2.19a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 3.25 2.5h.5z"/>
            </svg>
          </button>
          <button className="orgs-tab-reauth-btn" onClick={onReauthorize} disabled={reauthorizing}>
            {reauthorizing ? 'Redirecting...' : 'Re-authorize with GitHub'}
          </button>
        </div>
        {reauthorizeError && (
          <div className="orgs-tab-reauth-error">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{reauthorizeError}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrganizationsTab
