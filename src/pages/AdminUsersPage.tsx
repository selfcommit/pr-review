import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost, getCachedUser } from '../utils/api'
import './AdminUsersPage.css'

interface AdminUser {
  github_user_id: number
  login: string
  name: string | null
  avatar_url: string | null
  email: string | null
  is_admin: boolean
  created_at: string
  updated_at: string
  teams_last_synced_at: string | null
  stats_backfilled_at: string | null
  org_count: number
  team_count: number
  open_review_requests: number
  total_reviews: number
  last_activity_at: string | null
}

type SortKey =
  | 'created_at'
  | 'last_activity'
  | 'total_reviews'
  | 'open_requests'
  | 'login'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  const days = Math.floor(diffSec / 86400)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

function AdminUsersPage() {
  const navigate = useNavigate()
  const me = getCachedUser()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    if (!me?.is_admin) {
      navigate('/dashboard', { replace: true })
    }
  }, [me, navigate])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await apiGet<{ users: AdminUser[] }>('admin/users')
      setUsers(resp.users)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (me?.is_admin) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    if (!users) return []
    const q = search.trim().toLowerCase()
    const matched = q
      ? users.filter(
          u =>
            u.login.toLowerCase().includes(q) ||
            (u.name || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q)
        )
      : users.slice()
    matched.sort((a, b) => {
      switch (sortKey) {
        case 'login':
          return a.login.localeCompare(b.login)
        case 'total_reviews':
          return b.total_reviews - a.total_reviews
        case 'open_requests':
          return b.open_review_requests - a.open_review_requests
        case 'last_activity': {
          const av = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0
          const bv = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0
          return bv - av
        }
        case 'created_at':
        default:
          return (
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
          )
      }
    })
    return matched
  }, [users, search, sortKey])

  const handleToggleAdmin = async (u: AdminUser) => {
    if (u.github_user_id === me?.id && u.is_admin) {
      alert('You cannot remove your own admin access.')
      return
    }
    const action = u.is_admin ? 'revoke admin from' : 'grant admin to'
    if (!confirm(`Are you sure you want to ${action} ${u.login}?`)) return
    setBusyId(u.github_user_id)
    try {
      await apiPost('admin/toggle-admin', {
        github_user_id: u.github_user_id,
        is_admin: !u.is_admin,
      })
      setUsers(prev =>
        prev
          ? prev.map(x =>
              x.github_user_id === u.github_user_id
                ? { ...x, is_admin: !u.is_admin }
                : x
            )
          : prev
      )
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  if (!me?.is_admin) return null

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="admin-header-inner">
          <div className="admin-header-left">
            <button
              className="admin-back-btn"
              onClick={() => navigate('/dashboard')}
            >
              ← Back
            </button>
            <div>
              <h1 className="admin-title">Users</h1>
              <p className="admin-subtitle">
                {users ? `${users.length} total users` : 'Loading...'}
              </p>
            </div>
          </div>
          <button
            className="admin-refresh-btn"
            onClick={load}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-toolbar">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search login, name, or email"
            className="admin-search"
          />
          <label className="admin-sort">
            <span>Sort by</span>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
            >
              <option value="created_at">Newest</option>
              <option value="last_activity">Last active</option>
              <option value="total_reviews">Total reviews</option>
              <option value="open_requests">Open requests</option>
              <option value="login">Login (A-Z)</option>
            </select>
          </label>
        </div>

        {error && <div className="admin-error">{error}</div>}

        {loading && !users && (
          <div className="admin-loading">Loading users...</div>
        )}

        {users && filtered.length === 0 && (
          <div className="admin-empty">No users match your search.</div>
        )}

        {filtered.length > 0 && (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th className="num">Orgs</th>
                  <th className="num">Teams</th>
                  <th className="num">Open</th>
                  <th className="num">Reviews</th>
                  <th>Last active</th>
                  <th>Joined</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.github_user_id}>
                    <td>
                      <div className="admin-user-cell">
                        {u.avatar_url && (
                          <img
                            src={u.avatar_url}
                            alt={u.login}
                            className="admin-avatar"
                          />
                        )}
                        <div>
                          <div className="admin-user-login">
                            {u.login}
                            {u.is_admin && (
                              <span className="admin-badge">admin</span>
                            )}
                          </div>
                          {u.name && (
                            <div className="admin-user-name">{u.name}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="admin-email">{u.email || '—'}</td>
                    <td className="num">{u.org_count}</td>
                    <td className="num">{u.team_count}</td>
                    <td className="num">{u.open_review_requests}</td>
                    <td className="num">{u.total_reviews}</td>
                    <td>{formatRelative(u.last_activity_at)}</td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>
                      <button
                        className={`admin-toggle-btn ${u.is_admin ? 'admin-toggle-btn--revoke' : ''}`}
                        disabled={busyId === u.github_user_id}
                        onClick={() => handleToggleAdmin(u)}
                      >
                        {busyId === u.github_user_id
                          ? '...'
                          : u.is_admin
                            ? 'Revoke'
                            : 'Grant'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

export default AdminUsersPage
