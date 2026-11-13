
import { useState } from 'react'
import type { FormEvent } from 'react'

type User = {
  id: number
  name: string
  email: string
}

type AuthPageProps = {
  onLogin: (user: User) => void
}

function AuthPage({ onLogin }: AuthPageProps) {
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

  const inputStyle = {
    width: '100%',
    padding: '12px',
    boxSizing: 'border-box' as const,
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    fontSize: '14px',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f1f5f9',
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: '36px',
          borderRadius: '16px',
          backgroundColor: '#ffffff',
          boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
          boxSizing: 'border-box',
        }}
      >
        <h1
          style={{
            margin: '0 0 8px',
            textAlign: 'center',
            color: '#2563eb',
          }}
        >
          TeamFlow
        </h1>

        <p
          style={{
            textAlign: 'center',
            color: '#64748b',
            marginBottom: '28px',
          }}
        >
          팀 프로젝트를 한곳에서 관리하세요
        </p>

        <h2
          style={{
            fontSize: '20px',
            color: '#1e293b',
            marginBottom: '20px',
          }}
        >
          {isSignup ? '회원가입' : '로그인'}
        </h2>

        <form onSubmit={handleSubmit}>
          {isSignup && (
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="auth-name">이름</label>
              <input
                id="auth-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="이름을 입력하세요"
                required
                maxLength={50}
                style={{ ...inputStyle, marginTop: '6px' }}
              />
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="auth-email">이메일</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="example@email.com"
              required
              style={{ ...inputStyle, marginTop: '6px' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label htmlFor="auth-password">비밀번호</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8자 이상 입력하세요"
              required
              minLength={isSignup ? 8 : undefined}
              style={{ ...inputStyle, marginTop: '6px' }}
            />
          </div>

          {error && (
            <p style={{ color: '#dc2626', fontSize: '14px' }}>
              {error}
            </p>
          )}

          {message && (
            <p style={{ color: '#16a34a', fontSize: '14px' }}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px',
              backgroundColor: loading ? '#94a3b8' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading
              ? '처리 중...'
              : isSignup
                ? '회원가입'
                : '로그인'}
          </button>
        </form>

        <p
          style={{
            textAlign: 'center',
            marginTop: '24px',
            color: '#64748b',
            fontSize: '14px',
          }}
        >
          {isSignup ? '이미 계정이 있나요?' : '아직 계정이 없나요?'}{' '}
          <button
            type="button"
            onClick={changeMode}
            style={{
              border: 'none',
              background: 'none',
              color: '#2563eb',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            {isSignup ? '로그인' : '회원가입'}
          </button>
        </p>
      </div>
    </div>
  )
}

export default AuthPage
