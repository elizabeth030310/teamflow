
import { useState } from 'react'
import type { FormEvent } from 'react'

type User = {
  id: number
  name: string
  email: string
}

type AuthPageProps = {
  onLogin: (user: User) => void
  connectionError?: string
}

function AuthPage({ onLogin, connectionError }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const isSignup = mode === 'signup'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return

    setError('')
    setMessage('')
    setLoading(true)

    try {
      const response = await fetch(
        isSignup ? '/api/auth/signup' : '/api/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(
            isSignup
              ? { name, email, password }
              : { email, password }
          ),
        }
      )

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error('이미 가입된 이메일입니다.')
        }

        if (response.status === 401) {
          throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
        }

        if (response.status === 400) {
          throw new Error('입력한 정보를 확인해 주세요.')
        }

        throw new Error('요청 처리 중 오류가 발생했습니다.')
      }

      const data: User = await response.json()

      if (isSignup) {
        setMode('login')
        setPassword('')
        setMessage('회원가입이 완료되었습니다. 로그인해 주세요.')
      } else {
        onLogin(data)
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : '알 수 없는 오류가 발생했습니다.'
      )
    } finally {
      setLoading(false)
    }
  }

  const changeMode = () => {
    setMode(isSignup ? 'login' : 'signup')
    setError('')
    setMessage('')
    setPassword('')
  }

  return (
    <main className="tf-app tf-auth">
      <section className="tf-panel" aria-labelledby="auth-title">
        <h1>TeamFlow</h1>
        <p className="tf-auth-intro">팀 프로젝트를 한곳에서 관리하세요</p>
        <h2 id="auth-title">{isSignup ? '회원가입' : '로그인'}</h2>

        <form onSubmit={handleSubmit}>
          {isSignup && (
            <div>
              <label htmlFor="auth-name">이름</label>
              <input
                id="auth-name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={50}
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email">이메일</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="auth-password">비밀번호</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={isSignup ? 8 : undefined}
            />
          </div>

          {connectionError && !error && <p className="tf-error" role="alert">{connectionError}</p>}
          {error && <p className="tf-error" role="alert">{error}</p>}
          {message && <p className="tf-status" role="status">{message}</p>}
          {loading && <p className="tf-status" role="status">요청을 처리하는 중입니다.</p>}

          <button type="submit" className="tf-primary" disabled={loading}>
            {isSignup ? '회원가입' : '로그인'}
          </button>
        </form>

        <p className="tf-auth-switch">
          {isSignup ? '이미 계정이 있나요?' : '아직 계정이 없나요?'}{' '}
          <button type="button" onClick={changeMode} disabled={loading}>
            {isSignup ? '로그인' : '회원가입'}
          </button>
        </p>
      </section>
    </main>
  )
}

export default AuthPage
