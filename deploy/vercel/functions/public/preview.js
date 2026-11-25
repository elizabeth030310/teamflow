const login = document.querySelector('#login')
const logout = document.querySelector('#logout')
const session = document.querySelector('#session')

async function api(path, body) {
  return fetch('/api/auth/' + path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TeamFlow-Request': '1' },
    body: JSON.stringify(body),
  })
}

async function refresh() {
  const response = await api('me')
  if (response.status === 401) {
    session.textContent = '로그아웃 상태'
  } else if (response.ok) {
    const user = await response.json()
    session.textContent = `로그인 상태 (${user.role})`
  } else {
    session.textContent = `세션 확인 실패 (${response.status})`
  }
}

login.addEventListener('submit', async event => {
  event.preventDefault()
  const response = await api('login', Object.fromEntries(new FormData(login)))
  login.reset()
  if (response.ok) await refresh()
  else session.textContent = `로그인 실패 (${response.status})`
})

logout.addEventListener('click', async () => {
  const response = await api('logout', {})
  if (response.ok) await refresh()
  else session.textContent = `로그아웃 실패 (${response.status})`
})

refresh().catch(() => { session.textContent = '연결 실패' })
