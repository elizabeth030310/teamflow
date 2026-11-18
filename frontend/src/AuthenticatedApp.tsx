
import { useCallback, useEffect, useState } from 'react'
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
  const expireSession = useCallback(() => setUser(null), [])

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
      <main className="tf-app tf-auth">
        <p className="tf-status" role="status">로그인 상태를 확인하는 중입니다.</p>
      </main>
    )
  }

  if (!user) {
    return <AuthPage connectionError={error} onLogin={(nextUser) => {
      setError('')
      setUser(nextUser)
    }} />
  }

  return (
    <>
      <header className="tf-app tf-account">
        <span><strong>{user.name}</strong>님, 환영합니다!</span>
        <button type="button" onClick={handleLogout}>로그아웃</button>
        {error && <p className="tf-error" role="alert">{error}</p>}
      </header>
      <App key={user.id} userId={user.id} onSessionExpired={expireSession} />
    </>
  )
}

export default AuthenticatedApp
