import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrganizationsTabProps {
  orgAccess: OrgAccessResult
  onManageAccess: () => void
}

function OrganizationsTab({ orgAccess, onManageAccess }: OrganizationsTabProps) {
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
            This can happen if you haven't granted organization access or if your org restricts third-party apps.
          </p>
          <button className="orgs-tab-manage-btn" onClick={onManageAccess}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Manage Organization Access
          </button>
          <p className="orgs-tab-empty-hint">
            You can also manage app permissions at{' '}
            <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">
              github.com/settings/applications
            </a>.
          </p>
        </div>
      )}

      <div className="orgs-tab-help">
        <p className="orgs-tab-help-desc">
          Missing an organization? Sign in again to grant or revoke access.
        </p>

        <div className="orgs-tab-help-actions">
          <button className="orgs-tab-manage-btn" onClick={onManageAccess}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Manage Organization Access
          </button>
          <a
            className="orgs-tab-help-github-btn"
            href="https://github.com/settings/applications"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
            </svg>
            GitHub App Settings
          </a>
        </div>
      </div>
    </div>
  )
}

export default OrganizationsTab
