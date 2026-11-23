
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import App from './App'
import AdminDashboard from './AdminDashboard'
import AuthPage from './AuthPage'
import ThemeSelect from './ThemeSelect'
import type { User } from './authUser'
import { adminHref, dashboardHref } from './workspaceRoute'

function trackAccountHeader(header: HTMLElement | null) {
  if (!header) return

  const root = document.documentElement
  const updateHeight = () => {
    root.style.setProperty('--tf-account-height', `${header.offsetHeight}px`)
  }
  const observer = new ResizeObserver(updateHeight)
  updateHeight()
  observer.observe(header, { box: 'border-box' })

  return () => {
    observer.disconnect()
    root.style.removeProperty('--tf-account-height')
  }
}

function AuthenticatedApp() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [passwordFormOpen, setPasswordFormOpen] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [loginNotice, setLoginNotice] = useState('')
  const [accountAction, setAccountAction] = useState<'logout' | 'password' | null>(null)
  const expireSession = useCallback(() => {
    setPasswordFormOpen(false)
    setPasswordError('')
    setUser(null)
  }, [])
  useEffect(() => {
    if (!user) return
    function syncRoute() {
      if (user?.role === 'ADMIN' && window.location.hash !== adminHref) {
        window.history.replaceState(null, '', adminHref)
      } else if (user?.role === 'USER' && window.location.hash === adminHref) {
        window.location.replace(dashboardHref)
      }
    }
    syncRoute()
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [user])

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
    if (accountAction) return
    setAccountAction('logout')
    setError('')

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('로그아웃에 실패했습니다.')
      }

      expireSession()
    } catch {
      setError('로그아웃에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setAccountAction(null)
    }
  }

  function togglePasswordForm() {
    setPasswordError('')
    setPasswordFormOpen(!passwordFormOpen)
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (accountAction) return

    const form = event.currentTarget
    const fields = new FormData(form)
    const currentPassword = String(fields.get('currentPassword') ?? '')
    const newPassword = String(fields.get('newPassword') ?? '')
    const confirmation = String(fields.get('confirmation') ?? '')

    if ([...newPassword].length < 8 || new TextEncoder().encode(newPassword).length > 72) {
      setPasswordError('새 비밀번호는 8자 이상, UTF-8 기준 72바이트 이하여야 합니다.')
      return
    }
    if (newPassword !== confirmation) {
      setPasswordError('새 비밀번호와 비밀번호 확인이 일치하지 않습니다.')
      return
    }

    setPasswordError('')
    setError('')
    setAccountAction('password')
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      if (response.ok) {
        form.reset()
        setLoginNotice('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.')
        expireSession()
      } else if (response.status === 401) {
        expireSession()
        setError('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.')
      } else if (response.status === 400) {
        setPasswordError('현재 비밀번호가 올바른지, 새 비밀번호가 조건을 충족하는지 확인해 주세요.')
      } else {
        setPasswordError('비밀번호 변경에 실패했습니다. 다시 시도해 주세요.')
      }
    } catch {
      setPasswordError('서버 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setAccountAction(null)
    }
  }

  if (loading || (!user && accountAction)) {
    return (
      <main className="tf-app tf-auth">
        <p className="tf-status" role="status">
          {loading ? '로그인 상태를 확인하는 중입니다.' : '계정 요청을 처리하는 중입니다.'}
        </p>
      </main>
    )
  }

  if (!user) {
    return <AuthPage connectionError={error} loginNotice={loginNotice} onLogin={(nextUser) => {
      setError('')
      setLoginNotice('')
      setUser(nextUser)
    }} />
  }

  return (
    <>
      <header className="tf-app tf-account" ref={trackAccountHeader}>
        <span><strong>{user.name}</strong>님, 환영합니다!</span>
        <ThemeSelect />
        <button
          type="button"
          aria-expanded={passwordFormOpen}
          onClick={togglePasswordForm}
          disabled={Boolean(accountAction)}
        >
          비밀번호 변경
        </button>
        <button type="button" onClick={handleLogout} disabled={Boolean(accountAction)}>로그아웃</button>
        {error && <p className="tf-error" role="alert">{error}</p>}
        {passwordFormOpen && (
          <form
            className="tf-password-form"
            aria-labelledby="password-form-title"
            method="post"
            onSubmit={handlePasswordChange}
          >
            <h2 id="password-form-title">비밀번호 변경</h2>
            <div>
              <label htmlFor="current-password">현재 비밀번호</label>
              <input id="current-password" name="currentPassword" type="password"
                autoComplete="current-password" required readOnly={Boolean(accountAction)} />
            </div>
            <div>
              <label htmlFor="new-password">새 비밀번호</label>
              <input id="new-password" name="newPassword" type="password"
                autoComplete="new-password" aria-describedby="new-password-help"
                required readOnly={Boolean(accountAction)} />
              <p id="new-password-help">8자 이상, UTF-8 기준 최대 72바이트</p>
            </div>
            <div>
              <label htmlFor="confirm-password">새 비밀번호 확인</label>
              <input id="confirm-password" name="confirmation" type="password"
                autoComplete="new-password" required readOnly={Boolean(accountAction)} />
            </div>
            {passwordError && <p className="tf-error" role="alert">{passwordError}</p>}
            {accountAction === 'password' && <p className="tf-status" role="status">비밀번호를 변경하는 중입니다.</p>}
            <div className="tf-actions">
              <button type="submit" className="tf-primary" disabled={Boolean(accountAction)}>변경하기</button>
              <button type="button" onClick={togglePasswordForm} disabled={Boolean(accountAction)}>취소</button>
            </div>
          </form>
        )}
      </header>
      {user.role === 'ADMIN'
        ? <AdminDashboard key={user.id} onSessionExpired={expireSession} />
        : <App key={user.id} userId={user.id} onSessionExpired={expireSession} />}
    </>
  )
}

export default AuthenticatedApp
