import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrganizationsTabProps {
  orgAccess: OrgAccessResult
  installUrl: string | null
  onRefreshOrgs: () => void
  onReauth: () => void
  refreshing: boolean
}

function OrganizationsTab({ orgAccess, installUrl, onRefreshOrgs, onReauth, refreshing }: OrganizationsTabProps) {
  if (orgAccess.loading && orgAccess.memberOrgs.length === 0) {
    return (
      <div className="orgs-tab-loading">
        <div className="spinner"></div>
        <p>Checking organization access...</p>
      </div>
    )
  }

  const connected = orgAccess.memberOrgs.filter(o => o.accessible)
  const notInstalled = orgAccess.memberOrgs.filter(o => !o.accessible)

  const handleInstallApp = () => {
    if (installUrl) {
      window.open(installUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="orgs-tab">
      {orgAccess.needsReauth && (
        <div className="orgs-tab-reauth-banner">
          <div className="orgs-tab-reauth-banner-icon">
            <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="orgs-tab-reauth-banner-body">
            <p className="orgs-tab-reauth-banner-text">
              <strong>Organization access not granted.</strong>{' '}
              Your current session does not have permission to see your GitHub organizations.
              Sign in again to grant access to your private organizations.
            </p>
            <button className="orgs-tab-reauth-btn" onClick={onReauth}>
              <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
              </svg>
              Sign in again to grant access
            </button>
          </div>
        </div>
      )}

      {orgAccess.error && (
        <div className="orgs-tab-reauth-error">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>{orgAccess.error}</span>
        </div>
      )}

      {notInstalled.length > 0 && (
        <div className="orgs-tab-section">
          <div className="orgs-tab-section-header">
            <h2 className="orgs-tab-section-title orgs-tab-section-title-warning">
              App Not Installed
              <span className="orgs-tab-count orgs-tab-count-warning">{notInstalled.length}</span>
            </h2>
            <p className="orgs-tab-section-desc">
              The review dashboard app needs to be installed on these organizations
              before it can access their private repositories and pull requests.
            </p>
          </div>
          <div className="orgs-tab-list">
            {notInstalled.map(org => (
              <div key={org.login} className="orgs-tab-card orgs-tab-card-restricted">
                <div className="orgs-tab-card-left">
                  <img src={org.avatar_url} alt={org.login} className="orgs-tab-avatar" />
                  <div className="orgs-tab-card-info">
                    <span className="orgs-tab-card-name">{org.login}</span>
                    <span className="orgs-tab-card-role">{org.role === 'admin' ? 'Admin' : 'Member'}</span>
                  </div>
                </div>
                <div className="orgs-tab-card-right">
                  <span className="orgs-tab-status orgs-tab-status-restricted">Not Installed</span>
                </div>
              </div>
            ))}
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
              The app is installed on these organizations. Private PRs from these orgs will appear in your dashboard.
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

      {orgAccess.memberOrgs.length === 0 && !orgAccess.needsReauth && (
        <div className="orgs-tab-empty">
          <svg className="orgs-tab-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
          <h2>No organizations found</h2>
          <p>
            Install the app on your GitHub organizations to see them here.
            Once installed, private PRs from those organizations will appear in your dashboard.
          </p>
        </div>
      )}

      <div className="orgs-tab-help">
        <div className="orgs-tab-help-header">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <h3>How to connect an organization</h3>
        </div>

        <div className="orgs-tab-help-steps">
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">1</span>
            <div className="orgs-tab-help-step-text">
              <strong>Grant organization access</strong>
              <span>Sign in again and grant access to your organizations on the GitHub authorization screen.</span>
            </div>
          </div>
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">2</span>
            <div className="orgs-tab-help-step-text">
              <strong>Install the app on GitHub</strong>
              <span>Click the button below to open GitHub, where you can choose which organization to install the app on.</span>
            </div>
          </div>
          <div className="orgs-tab-help-step">
            <span className="orgs-tab-help-step-num">3</span>
            <div className="orgs-tab-help-step-text">
              <strong>Come back and refresh</strong>
              <span>After installing, click "Refresh Organizations" below to see the updated status.</span>
            </div>
          </div>
        </div>

        <div className="orgs-tab-help-actions">
          {installUrl && (
            <button
              className="orgs-tab-manage-btn"
              onClick={handleInstallApp}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
              </svg>
              Install App on Organization
            </button>
          )}
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
            Only organization admins can install the app. If you are a member (not admin),
            ask your org admin to install the app, or request installation from the GitHub page.
          </p>
          <p>
            If your organizations are not showing up, you may need to sign in again and
            explicitly grant access to each organization on the GitHub authorization screen.
          </p>
        </div>
      </div>
    </div>
  )
}

export default OrganizationsTab
