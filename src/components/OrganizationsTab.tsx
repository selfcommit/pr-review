import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrganizationsTabProps {
  orgAccess: OrgAccessResult
  onRefreshOrgs: () => void
  refreshing: boolean
}

function OrganizationsTab({ orgAccess, onRefreshOrgs, refreshing }: OrganizationsTabProps) {
  if (orgAccess.loading && orgAccess.memberOrgs.length === 0) {
    return (
      <div className="orgs-tab-loading">
        <div className="spinner"></div>
        <p>Checking organization access...</p>
      </div>
    )
  }

  return (
    <div className="orgs-tab">
      {orgAccess.error && (
        <div className="orgs-tab-reauth-error">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>{orgAccess.error}</span>
        </div>
      )}

      {orgAccess.memberOrgs.length > 0 && (
        <div className="orgs-tab-section">
          <div className="orgs-tab-section-header">
            <h2 className="orgs-tab-section-title orgs-tab-section-title-ok">
              Connected
              <span className="orgs-tab-count orgs-tab-count-ok">{orgAccess.memberOrgs.length}</span>
            </h2>
            <p className="orgs-tab-section-desc">
              Your GitHub account has access to these organizations. Private PRs from these orgs appear in your dashboard.
            </p>
          </div>
          <div className="orgs-tab-list">
            {orgAccess.memberOrgs.map(org => (
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
          <h2>No organizations found</h2>
          <p>
            GitHub did not return any organizations for your account. This is usually caused by one of the following:
          </p>
          <div className="orgs-tab-troubleshoot">
            <div className="orgs-tab-troubleshoot-item">
              <strong>1. OAuth scopes missing</strong>
              <span>
                Your token needs <code>read:org</code> scope. Current scopes: <code>{orgAccess.oauthScopes || '(none)'}</code>.
                {!orgAccess.oauthScopes?.includes('read:org') && (
                  <> Sign out and sign back in to get a token with the correct scopes.</>
                )}
              </span>
            </div>
            <div className="orgs-tab-troubleshoot-item">
              <strong>2. Organization has OAuth app restrictions</strong>
              <span>
                Many organizations restrict third-party OAuth app access by default. An org admin must approve this app before it can see that organization. Ask your org admin to visit: <code>github.com/orgs/YOUR_ORG/policies/applications</code>
              </span>
            </div>
            <div className="orgs-tab-troubleshoot-item">
              <strong>3. You haven't granted access for a specific org</strong>
              <span>
                When signing in, GitHub may ask you to grant access per-organization. You can manage this at{' '}
                <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">
                  github.com/settings/applications
                </a>.
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="orgs-tab-help">
        <div className="orgs-tab-help-header">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <h3>How organization access works</h3>
        </div>

        <div className="orgs-tab-help-steps">
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">1</span>
            <div className="orgs-tab-help-step-text">
              <strong>Automatic access</strong>
              <span>Organizations you belong to on GitHub are automatically connected when you sign in.</span>
            </div>
          </div>
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">2</span>
            <div className="orgs-tab-help-step-text">
              <strong>Missing an organization?</strong>
              <span>If an organization isn't listed, sign out and sign back in to refresh your access. You may also need to approve the OAuth app for that organization in your GitHub settings.</span>
            </div>
          </div>
        </div>

        <div className="orgs-tab-help-actions">
          <button
            className="orgs-tab-refresh-btn"
            onClick={onRefreshOrgs}
            disabled={refreshing || orgAccess.loading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
            {refreshing || orgAccess.loading ? 'Refreshing...' : 'Refresh Organizations'}
          </button>
        </div>

        <div className="orgs-tab-help-note">
          <p>
            Some organizations require OAuth app approval before granting access.
            If your org is missing, check your organization's third-party access settings on GitHub.
          </p>
        </div>
      </div>
    </div>
  )
}

export default OrganizationsTab
