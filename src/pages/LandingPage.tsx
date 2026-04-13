import { useState } from 'react'
import './LandingPage.css'

function LandingPage() {
  const [isLoading, setIsLoading] = useState(false)

  const handleSignIn = async () => {
    setIsLoading(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const origin = window.top ? window.top.location.origin : window.location.origin
      const redirectUri = `${origin}/auth/callback`
      const response = await fetch(`${supabaseUrl}/functions/v1/github-auth/login?redirect_uri=${encodeURIComponent(redirectUri)}`)
      const data = await response.json()

      if (data.url) {
        sessionStorage.setItem('github_oauth_state', data.state)
        window.top ? (window.top.location.href = data.url) : (window.location.href = data.url)
      }
    } catch (error) {
      console.error('Sign in error:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="landing-container">
      <div className="landing-content">
        <div className="hero-section">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>

          <h1 className="hero-title">GitHub Review Dashboard</h1>
          <p className="hero-description">
            Stay on top of your code reviews. See all pull requests where your review is requested,
            organized by organization.
          </p>

          <button
            className="signin-button"
            onClick={handleSignIn}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="loading-text">Signing in...</span>
            ) : (
              <>
                <svg className="github-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                Sign in with GitHub
              </>
            )}
          </button>
        </div>

        <div className="features-section">
          <div className="feature">
            <div className="feature-icon">📋</div>
            <h3>Centralized View</h3>
            <p>See all PRs requiring your review in one place</p>
          </div>

          <div className="feature">
            <div className="feature-icon">🏢</div>
            <h3>Multi-Organization</h3>
            <p>Works across all organizations where you're a member</p>
          </div>

          <div className="feature">
            <div className="feature-icon">⚡</div>
            <h3>Real-Time Data</h3>
            <p>Always up-to-date with the latest review requests</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LandingPage
