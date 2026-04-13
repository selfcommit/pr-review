import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'

const ERROR_CODE_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the sign-in request on GitHub.",
  bad_verification_code: "The authorization code expired or was already used. Please sign in again.",
  incorrect_client_credentials: "The OAuth app credentials are misconfigured. Please contact the administrator.",
  redirect_uri_mismatch: "The OAuth redirect URI is misconfigured. Please contact the administrator.",
  oauth_not_configured: "GitHub OAuth is not configured on this server. Please contact the administrator.",
  no_code: "No authorization code was received from GitHub. The request may have expired.",
  invalid_state: "The sign-in session data was corrupted or tampered with.",
  user_fetch_failed: "Your GitHub profile could not be retrieved after signing in.",
  user_fetch_error: "Your GitHub profile could not be retrieved after signing in.",
}

function getFriendlyError(message: string, code: string | null): { heading: string; detail: string } {
  if (code && ERROR_CODE_MESSAGES[code]) {
    return {
      heading: ERROR_CODE_MESSAGES[code],
      detail: message !== ERROR_CODE_MESSAGES[code] ? message : "",
    }
  }
  return {
    heading: "Sign-in failed.",
    detail: message,
  }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [authError, setAuthError] = useState<{ heading: string; detail: string } | null>(null)

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    console.log('[App] raw window.location.hash:', window.location.hash)

    if (hash) {
      const params = new URLSearchParams(hash)
      const accessToken = params.get('access_token')
      const error = params.get('auth_error')
      const errorCode = params.get('auth_error_code')
      const state = params.get('state')
      const savedState = sessionStorage.getItem('github_oauth_state')

      console.log('[App] hash params - access_token present:', !!accessToken)
      console.log('[App] hash params - auth_error:', error || '(none)')
      console.log('[App] hash params - auth_error_code:', errorCode || '(none)')
      console.log('[App] hash params - state from hash:', state)
      console.log('[App] sessionStorage savedState:', savedState)
      console.log('[App] state match:', state === savedState)

      window.history.replaceState(null, '', window.location.pathname)

      if (error) {
        console.log('[App] auth error detected:', error, '| code:', errorCode)
        setAuthError(getFriendlyError(error, errorCode))
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
            setAuthError({
              heading: "Sign-in failed.",
              detail: "Could not save your session to local storage. Please check your browser settings and try again.",
            })
            setIsAuthenticated(false)
            return
          }
        }
      } else if (accessToken) {
        console.warn('[App] state mismatch - accessToken present but state did not match')
        setAuthError({
          heading: "Sign-in could not be completed due to a security check failure.",
          detail: "The session state did not match. This can happen if you opened multiple sign-in tabs or your session expired. Please try signing in again.",
        })
        setIsAuthenticated(false)
        return
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
          background: '#1e1e2e',
          borderBottom: '1px solid rgba(239, 68, 68, 0.4)',
          color: '#fca5a5',
          padding: '14px 24px',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1 }}>
            <svg style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1, color: '#f87171' }} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: '#f87171' }}>{authError.heading}</span>
              {authError.detail && (
                <span style={{ color: '#fca5a5', marginLeft: 6 }}>{authError.detail}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => setAuthError(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: 18,
              lineHeight: 1,
              flexShrink: 0,
            }}
            aria-label="Dismiss error"
          >
            &times;
          </button>
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
