import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash.slice(1)

    if (hash) {
      const params = new URLSearchParams(hash)
      const accessToken = params.get('access_token')
      const error = params.get('auth_error')
      const state = params.get('state')
      const savedState = sessionStorage.getItem('github_oauth_state')

      window.history.replaceState(null, '', window.location.pathname)

      if (error) {
        setAuthError(error)
        setIsAuthenticated(false)
        return
      }

      if (accessToken && state && state === savedState) {
        const userRaw = params.get('user')
        if (userRaw) {
          try {
            localStorage.setItem('github_access_token', accessToken)
            localStorage.setItem('github_user', userRaw)
            sessionStorage.removeItem('github_oauth_state')
            setIsAuthenticated(true)
            return
          } catch {
          }
        }
      }
    }

    const token = localStorage.getItem('github_access_token')
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
