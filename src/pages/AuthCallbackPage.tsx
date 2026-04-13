import { useEffect } from 'react'

function AuthCallbackPage() {
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return

    const params = new URLSearchParams(hash)
    const payload: Record<string, string> = {}
    for (const [key, value] of params.entries()) {
      payload[key] = value
    }

    if (window.opener) {
      window.opener.postMessage(
        { type: 'github-oauth-callback', ...payload },
        window.location.origin
      )
      window.close()
    }
  }, [])

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      color: '#64748b',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      Completing sign-in...
    </div>
  )
}

export default AuthCallbackPage
