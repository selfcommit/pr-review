import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { isInIframe } from '../utils/iframe'
import { setSessionToken, setCachedUser } from '../utils/api'
import './LandingPage.css'

function LandingPage() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  const handleOAuthMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== 'github-oauth-callback') return

    const { session_token, user, state, auth_error } = event.data
    const savedState = sessionStorage.getItem('github_oauth_state')

    if (auth_error) {
      setSignInError(auth_error)
      setIsLoading(false)
      return
    }

    if (session_token && state && state === savedState && user) {
      setSessionToken(session_token)
      setCachedUser(JSON.parse(user))
      sessionStorage.removeItem('github_oauth_state')
      navigate('/dashboard')
    } else {
      setSignInError('Sign-in could not be verified. Please try again.')
      setIsLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [handleOAuthMessage])

  const handleSignIn = async () => {
    setIsLoading(true)
    setSignInError(null)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const origin = window.location.origin
      const callbackPath = isInIframe() ? '/auth/callback' : ''
      const redirectTo = encodeURIComponent(origin + callbackPath)
      const loginUrl = `${supabaseUrl}/functions/v1/github-auth/login?redirect_to=${redirectTo}`

      const response = await fetch(loginUrl)
      const data = await response.json()

      if (data.url) {
        sessionStorage.setItem('github_oauth_state', data.state)

        if (isInIframe()) {
          const popup = window.open(data.url, 'github-oauth', 'width=600,height=700,menubar=no,toolbar=no')
          if (!popup) {
            setSignInError('Pop-up was blocked by your browser. Please allow pop-ups for this site and try again.')
            setIsLoading(false)
          }
        } else {
          window.location.href = data.url
        }
      } else {
        const message = data.message || data.error || 'Failed to initiate sign-in. Please try again.'
        setSignInError(message)
        setIsLoading(false)
      }
    } catch (error) {
      setSignInError(
        error instanceof Error && error.message
          ? `Could not reach the authentication service: ${error.message}. Check your connection and try again.`
          : 'Could not reach the authentication service. Check your connection and try again.'
      )
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

          {signInError && (
            <div className="signin-error">
              <svg className="signin-error-icon" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>{signInError}</span>
            </div>
          )}
        </div>

        <div className="features-section">
          <div className="feature">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
                <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <h3>Centralized View</h3>
            <p>See all PRs requiring your review in one place</p>
          </div>

          <div className="feature">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
                <path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>
            <h3>Multi-Organization</h3>
            <p>Works across all organizations where you're a member</p>
          </div>

          <div className="feature">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
                <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <h3>Real-Time Data</h3>
            <p>Always up-to-date with the latest review requests</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default LandingPage
