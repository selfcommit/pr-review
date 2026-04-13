import type { OrgAccessResult } from '../hooks/useOrgAccess'

interface OrganizationsTabProps {
  orgAccess: OrgAccessResult
  onManageAccess: () => void
  managing: boolean
  manageError: string | null
}

function OrganizationsTab({ orgAccess, onManageAccess, managing, manageError }: OrganizationsTabProps) {
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
              These organizations have not granted this app access to their data.
              Use "Manage Organization Access" below to update permissions.
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
            Click "Manage Organization Access" below to connect your organizations.
            GitHub will show you all orgs you belong to so you can grant access.
          </p>
        </div>
      )}

      <div className="orgs-tab-help">
        <div className="orgs-tab-help-header">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <h3>Add or change organization access</h3>
        </div>
        <p className="orgs-tab-help-desc">
          This will re-open the GitHub authorization screen where you can see all your
          organizations and choose which ones to grant access to. You can use this to
          both add new organizations and revoke access from existing ones.
        </p>

        <div className="orgs-tab-help-actions">
          <button
            className="orgs-tab-manage-btn"
            onClick={onManageAccess}
            disabled={managing}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {managing ? 'Redirecting to GitHub...' : 'Manage Organization Access'}
          </button>
        </div>

        <div className="orgs-tab-help-note">
          <p>
            After granting access on GitHub, you will be redirected back here and your
            organization list will update automatically.
          </p>
          <p>
            If an organization shows "Request" instead of "Grant" on GitHub, your
            org admin needs to approve the app before it can access that org's data.
          </p>
        </div>

        {manageError && (
          <div className="orgs-tab-reauth-error">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{manageError}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrganizationsTab
