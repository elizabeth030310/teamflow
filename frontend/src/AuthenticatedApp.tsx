
import { useEffect, useState } from 'react'
import App from './App'
import AuthPage from './AuthPage'

type User = {
  id: number
  name: string
  email: string
}

function AuthenticatedApp() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function checkLogin() {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        })

        if (response.ok) {
          const data: User = await response.json()

          if (!cancelled) {
            setUser(data)
          }
        } else if (response.status !== 401) {
          throw new Error('로그인 상태를 확인하지 못했습니다.')
        }
      } catch {
        if (!cancelled) {
          setError('서버 연결을 확인해 주세요.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    checkLogin()

    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogout() {
    setError('')

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('로그아웃에 실패했습니다.')
      }

      setUser(null)
    } catch {
      setError('로그아웃에 실패했습니다. 다시 시도해 주세요.')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        로그인 상태를 확인하는 중...
      </div>
    )
  }

  if (!user) {
    return <AuthPage onLogin={setUser} />
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '16px',
          padding: '12px 24px',
          backgroundColor: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          color: '#1e293b',
        }}
      >
        <span>
          <strong>{user.name}</strong>님, 환영합니다!
        </span>

        <button
          type="button"
          onClick={handleLogout}
          style={{
            padding: '8px 14px',
            backgroundColor: '#475569',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          로그아웃
        </button>
      </div>

      {error && (
        <p style={{ color: '#dc2626', textAlign: 'center' }}>
          {error}
        </p>
      )}

      <App />
    </div>
  )
}

export default AuthenticatedApp
