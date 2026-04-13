import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrganizationsTabProps {
  orgAccess: OrgAccessResult
  onReauthorize: () => void
  reauthorizing: boolean
}

function OrganizationsTab({ orgAccess, onReauthorize, reauthorizing }: OrganizationsTabProps) {
  const clientId = localStorage.getItem('github_client_id')

  const handleGrantAccess = (orgLogin: string) => {
    if (clientId) {
      window.open(
        `https://github.com/settings/connections/applications/${clientId}`,
        '_blank',
        'noopener,noreferrer'
      )
    } else {
      window.open(
        `https://github.com/organizations/${orgLogin}/settings/oauth_application_policy`,
        '_blank',
        'noopener,noreferrer'
      )
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

  if (orgAccess.memberOrgs.length === 0) {
    return (
      <div className="orgs-tab-empty">
        <svg className="orgs-tab-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
        <h2>No organizations found</h2>
        <p>You don't appear to be a member of any GitHub organizations, or the app lacks permission to see them.</p>
        <button className="orgs-tab-reauth-btn" onClick={onReauthorize} disabled={reauthorizing}>
          {reauthorizing ? 'Redirecting...' : 'Re-authorize with GitHub'}
        </button>
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
    </div>
  )
}

export default OrganizationsTab
