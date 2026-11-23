
import { apiFetch } from './apiFetch.ts'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import ThemeSelect from './ThemeSelect.tsx'
import type { User } from './authUser'

type AuthPageProps = {
  onLogin: (user: User) => void
  connectionError?: string
  loginNotice?: string
}

function AuthPage({ onLogin, connectionError, loginNotice }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [code, setCode] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const codeInput = useRef<HTMLInputElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)

  const isSignup = mode === 'signup'

  useEffect(() => {
    if (!resendAt) return
    const timer = window.setTimeout(() => setResendAt(0), Math.max(0, resendAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [resendAt])

  useEffect(() => {
    if (codeRequested) codeInput.current?.focus()
  }, [codeRequested])

  const requestCode = async () => {
    const response = await apiFetch('/api/auth/signup/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After')) || 60
      setResendAt(Date.now() + seconds * 1000)
      throw new Error(`발송 요청 한도에 도달했습니다. ${seconds}초 후 다시 요청해 주세요.`)
    }
    if (response.status === 400) throw new Error('이메일 형식을 확인해 주세요.')
    if (!response.ok) {
      setResendAt(Date.now() + 60_000)
      throw new Error('인증 메일을 보낼 수 없습니다. 잠시 후 다시 요청해 주세요.')
    }
    const data: { resendAfterSeconds: number } = await response.json()
    setResendAt(Date.now() + data.resendAfterSeconds * 1000)
    setCode('')
    setCodeRequested(true)
    setMessage('가입할 수 있는 이메일이면 인증번호를 보냈습니다. 5분 안에 입력해 주세요.')
  }

  const resendCode = async () => {
    if (loading || resendAt) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      await requestCode()
    } catch (err) {
      setError(err instanceof Error && !(err instanceof TypeError)
        ? err.message
        : '서버 연결을 확인한 뒤 다시 요청해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return

    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (isSignup && !codeRequested) {
        if (!resendAt) await requestCode()
        return
      }
      if (isSignup && new TextEncoder().encode(password).length > 72) {
        throw new Error('비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.')
      }
      const response = await apiFetch(
        isSignup ? '/api/auth/signup' : '/api/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(
            isSignup
              ? { name, email, password, code }
              : { email, password }
          ),
        }
      )

      if (!response.ok) {
        if (response.status === 422) {
          throw new Error('인증번호가 올바르지 않거나 만료되었습니다. 번호를 확인하거나 다시 받아 주세요.')
        }

        if (response.status === 401) {
          throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.')
        }

        if (response.status === 400) {
          throw new Error('입력한 정보를 확인해 주세요.')
        }

        if (response.status === 429) {
          throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
        }

        if (response.status === 503) {
          throw new Error('현재 이메일 인증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.')
        }

        throw new Error('요청 처리 중 오류가 발생했습니다.')
      }

      const data: User = await response.json()

      if (isSignup) {
        setMode('login')
        setName('')
        setPassword('')
        setCode('')
        setCodeRequested(false)
        setMessage('회원가입이 완료되었습니다. 로그인해 주세요.')
      } else {
        onLogin(data)
      }
    } catch (err) {
      setError(
        err instanceof Error && !(err instanceof TypeError)
          ? err.message
          : '서버 연결을 확인한 뒤 다시 요청해 주세요.'
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
    setCode('')
    setCodeRequested(false)
  }

  return (
    <main className="tf-app tf-auth">
      <section className="tf-panel" aria-labelledby="auth-title">
        <header className="tf-auth-heading">
          <h1>TeamFlow</h1>
          <ThemeSelect />
        </header>
        <p className="tf-auth-intro">팀 프로젝트를 한곳에서 관리하세요</p>
        <h2 id="auth-title">{isSignup ? '회원가입' : '로그인'}</h2>
        {!isSignup && !message && loginNotice && <p className="tf-status" role="status">{loginNotice}</p>}

        <form onSubmit={handleSubmit}>
          {isSignup && codeRequested && (
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
              ref={emailInput}
              id="auth-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              readOnly={loading || (isSignup && codeRequested)}
              maxLength={isSignup ? 255 : undefined}
              required
            />
          </div>

          {(!isSignup || codeRequested) && <div>
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
              aria-describedby={isSignup ? 'auth-password-help' : undefined}
            />
            {isSignup && <p id="auth-password-help">8자 이상, UTF-8 기준 최대 72바이트</p>}
          </div>}

          {isSignup && codeRequested && (
            <div>
              <label htmlFor="auth-code">이메일 인증번호</label>
              <input
                ref={codeInput}
                id="auth-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                aria-describedby="auth-code-help"
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))}
              />
              <p id="auth-code-help">숫자 6자리를 입력해 주세요. 잘못된 번호를 5번 입력하면 새 번호가 필요합니다.</p>
              <button type="button" disabled={loading || Boolean(resendAt)} onClick={resendCode}>
                인증번호 다시 받기
              </button>
              <button type="button" disabled={loading} onClick={() => {
                setCodeRequested(false)
                setCode('')
                setPassword('')
                setError('')
                setMessage('')
                emailInput.current?.focus()
              }}>
                이메일 수정
              </button>
            </div>
          )}
          {isSignup && Boolean(resendAt) && <p className="tf-status">발송 대기시간이 지나면 다시 요청할 수 있습니다.</p>}

          {connectionError && !error && <p className="tf-error" role="alert">{connectionError}</p>}
          {error && <p className="tf-error" role="alert">{error}</p>}
          {message && <p className="tf-status" role="status">{message}</p>}
          {loading && <p className="tf-status" role="status">요청을 처리하는 중입니다.</p>}

          <button type="submit" className="tf-primary"
            disabled={loading || (isSignup && !codeRequested && Boolean(resendAt))}>
            {isSignup ? (codeRequested ? '인증하고 가입 완료' : '인증번호 받기') : '로그인'}
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
