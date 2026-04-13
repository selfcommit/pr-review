import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code')
      const state = searchParams.get('state')
      const savedState = sessionStorage.getItem('github_oauth_state')

      if (!code) {
        setError('No authorization code received')
        return
      }

      if (state !== savedState) {
        setError('State mismatch - possible security issue')
        return
      }

      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const response = await fetch(
          `${supabaseUrl}/functions/v1/github-auth/callback?code=${code}`
        )

        const data = await response.json()

        if (data.error) {
          setError(data.error)
          return
        }

        localStorage.setItem('github_access_token', data.access_token)
        localStorage.setItem('github_user', JSON.stringify(data.user))
        sessionStorage.removeItem('github_oauth_state')

        navigate('/dashboard')
      } catch (err) {
        setError('Failed to complete authentication')
        console.error('Auth callback error:', err)
      }
    }

    handleCallback()
  }, [searchParams, navigate])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '24px'
    }}>
      {error ? (
        <div style={{
          textAlign: 'center',
          maxWidth: '500px'
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '16px' }}>Authentication Error</h2>
          <p style={{ color: '#94a3b8', marginBottom: '24px' }}>{error}</p>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              border: 'none',
              padding: '12px 32px',
              fontSize: '16px',
              fontWeight: '600',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Return to Home
          </button>
        </div>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            border: '4px solid rgba(59, 130, 246, 0.3)',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 24px'
          }}></div>
          <p style={{ color: '#94a3b8', fontSize: '18px' }}>Completing sign in...</p>
        </div>
      )}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default AuthCallback
