import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    console.log('[App] raw window.location.hash:', window.location.hash)

    if (hash) {
      const params = new URLSearchParams(hash)
      const accessToken = params.get('access_token')
      const error = params.get('auth_error')
      const state = params.get('state')
      const savedState = sessionStorage.getItem('github_oauth_state')

      console.log('[App] hash params - access_token present:', !!accessToken)
      console.log('[App] hash params - auth_error:', error || '(none)')
      console.log('[App] hash params - state from hash:', state)
      console.log('[App] sessionStorage savedState:', savedState)
      console.log('[App] state match:', state === savedState)

      window.history.replaceState(null, '', window.location.pathname)

      if (error) {
        console.log('[App] auth error detected, setting error state:', error)
        setAuthError(error)
        setIsAuthenticated(false)
        return
      }

      if (accessToken && state && state === savedState) {
        const userRaw = params.get('user')
        console.log('[App] user param present:', !!userRaw)
        if (userRaw) {
          try {
            localStorage.setItem('github_access_token', accessToken)
            localStorage.setItem('github_user', userRaw)
            sessionStorage.removeItem('github_oauth_state')
            console.log('[App] auth success, setting authenticated')
            setIsAuthenticated(true)
            return
          } catch (e) {
            console.error('[App] failed to store auth data:', e)
          }
        }
      } else {
        console.warn('[App] auth conditions not met - accessToken:', !!accessToken, 'state present:', !!state, 'stateMatch:', state === savedState)
      }
    }

    const token = localStorage.getItem('github_access_token')
    console.log('[App] no hash, existing token present:', !!token)
    setIsAuthenticated(!!token)
  }, [])

  if (isAuthenticated === null) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        color: '#64748b'
      }}>
        Loading...
      </div>
    )
  }

  return (
    <BrowserRouter>
      {authError && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0,
          background: '#ef4444',
          color: 'white',
          padding: '12px 24px',
          textAlign: 'center',
          zIndex: 1000,
          fontSize: '14px',
        }}>
          Authentication error: {authError}
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LandingPage />}
        />
        <Route
          path="/dashboard"
          element={isAuthenticated ? <DashboardPage /> : <Navigate to="/" replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
