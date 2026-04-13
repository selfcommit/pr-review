import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import DashboardPage from './pages/DashboardPage'
import AuthCallback from './pages/AuthCallback'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
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
      <Routes>
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LandingPage />}
        />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/dashboard"
          element={isAuthenticated ? <DashboardPage /> : <Navigate to="/" replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
