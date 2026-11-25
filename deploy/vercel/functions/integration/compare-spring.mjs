import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { accountHandler } from '../src/account-api.ts'
import { authHandler, authSettings } from '../src/auth.ts'
import { authStore } from '../src/auth-store.ts'

const database = /^jdbc:postgresql:\/\/127\.0\.0\.1:(\d{4,5})\/(teamflow_test_[0-9a-f]{32})$/
  .exec(process.env.TEAMFLOW_TEST_DB_URL ?? '')
const databasePassword = process.env.TEAMFLOW_TEST_DB_PASSWORD ?? ''
const databasePort = Number(database?.[1])
assert.ok(database && databasePort >= 1024 && databasePort <= 65535 &&
  ![5432, 5433].includes(databasePort) && /^[0-9a-f]{32}$/.test(databasePassword),
'Expected the disposable Spring test database')

const { email, password, admin, adminPassword, id, contracts, springCodeEmail, springCode, nodeSignupEmail }
  = JSON.parse(readFileSync(0, 'utf8'))
const pool = new Pool({
  host: '127.0.0.1', port: databasePort, database: database[2], user: 'teamflow_test',
  password: databasePassword, ssl: false, max: 6, connectionTimeoutMillis: 3_000,
})
const store = authStore(pool)
const origin = 'https://teamflow.example.test'
const settings = authSettings({ TEAMFLOW_AUTH_ORIGINS: origin })
const routes = Object.fromEntries(['login', 'me', 'logout'].map(route => [
  route, authHandler(route, () => authStore(pool), () => settings),
]))
const request = (route, headers, body) => routes[route](new Request(origin + '/api/auth/' + route, {
  method: route === 'me' ? 'GET' : 'POST', headers, body,
}))
const writeHeaders = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-TeamFlow-Request': '1' }
const login = (email, password, cookie) => request('login', {
  ...writeHeaders, 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }),
}, JSON.stringify({ email, password }))
const cookieOf = response => response.headers.get('Set-Cookie').split(';')[0]
const hashOf = cookie => createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest()
const me = cookie => request('me', { Cookie: cookie })
const parity = async (name, response) => {
  const expected = contracts[name]
  assert.equal(response.status, expected.status, name)
  if (expected.body !== undefined) assert.deepEqual(await response.json(), expected.body, name)
  assert.equal(response.headers.get('cache-control'), 'private, no-store', name)
}

try {
  await pool.query(readFileSync(new URL('../sql/001-auth.sql', import.meta.url), 'utf8'))
  const originalHash = (await pool.query('SELECT password FROM users WHERE id = $1', [id])).rows[0].password
  assert.ok(originalHash.startsWith('$2a$'))
  await parity('anonymous', await request('me'))
  await parity('missingHeader', await request('logout', { Origin: origin }))
  await parity('foreignOrigin', await request('logout', { ...writeHeaders, Origin: 'https://other.example.test' }))
  assert.equal((await request('logout', { ...writeHeaders, 'Sec-Fetch-Site': 'same-site' })).status, 403)
  await parity('invalid', await login(email, ''))
  await parity('wrong', await login(email, 'wrong-password'))
  await parity('unknown', await login('missing@example.test', password))
  await parity('long', await login(email, password + 'a'))
  await parity('adminLogin', await login(admin, adminPassword))

  const signedIn = await login(' ' + email.toUpperCase() + ' ', password)
  const cookie = cookieOf(signedIn)
  await parity('memberLogin', signedIn)
  assert.match(signedIn.headers.get('Set-Cookie'),
    /^__Host-teamflow-session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax$/)
  const row = (await pool.query('SELECT token_hash FROM teamflow_sessions WHERE user_id = $1', [id])).rows[0]
  assert.deepEqual(row.token_hash, hashOf(cookie))
  await parity('me', await me(cookie))

  const rotated = cookieOf(await login(email, password, cookie))
  assert.notEqual(rotated, cookie)
  await parity('anonymous', await me(cookie))
  const loggedOut = await request('logout', { ...writeHeaders, Cookie: rotated })
  assert.match(loggedOut.headers.get('Set-Cookie'), /Max-Age=0$/)
  await parity('logout', loggedOut)
  await parity('anonymous', await me(rotated))
  await parity('logout', await request('logout', writeHeaders))

  const expired = cookieOf(await login(email, password))
  const setExpiry = seconds => pool.query(
    "UPDATE teamflow_sessions SET expires_at = clock_timestamp() + $1::int * interval '1 second' WHERE token_hash = $2",
    [seconds, hashOf(expired)])
  await setExpiry(1)
  await parity('me', await me(expired))
  const renewed = await pool.query(
    "SELECT expires_at > clock_timestamp() + interval '29 minutes' AS renewed FROM teamflow_sessions WHERE token_hash = $1",
    [hashOf(expired)])
  assert.equal(renewed.rows[0].renewed, true)
  await setExpiry(-1)
  await parity('anonymous', await me(expired))

  const revoked = cookieOf(await login(email, password))
  assert.equal((await pool.query('SELECT 1 FROM teamflow_sessions WHERE token_hash = $1', [hashOf(expired)])).rowCount, 0)
  const setStatus = status => pool.query(
    'UPDATE users SET account_status = $1, access_revision = access_revision + 1 WHERE id = $2', [status, id])
  await setStatus('SUSPENDED')
  await parity('suspendedLogin', await login(email, password))
  await parity('revoked', await me(revoked))
  await setStatus('WITHDRAWN')
  await parity('withdrawnLogin', await login(email, password))
  await setStatus('ACTIVE')
  await parity('revoked', await me(revoked))
  const passwordRevision = cookieOf(await login(email, password))
  await pool.query('UPDATE users SET access_revision = access_revision + 1 WHERE id = $1', [id])
  await parity('revoked', await me(passwordRevision))
  assert.equal((await pool.query('SELECT password FROM users WHERE id = $1', [id])).rows[0].password, originalHash)

  const reset = () => pool.query('UPDATE teamflow_login_window SET expires_at = clock_timestamp()')
  await reset()
  const bothInstances = [store, authStore(pool)]
  const reservation = (address, account, index) => bothInstances[index % 2].reserveLogin(address, account)
  const addressLimited = await Promise.all(Array.from({ length: 21 }, (_, index) =>
    reservation('fixed-address', 'account-' + index, index)))
  assert.equal(addressLimited.filter(Boolean).length, 20)
  await reset()
  const accountLimited = await Promise.all(Array.from({ length: 31 }, (_, index) =>
    reservation('address-' + index, 'fixed-account', index)))
  assert.equal(accountLimited.filter(Boolean).length, 30)
  await reset()
  const globalLimited = await Promise.all(Array.from({ length: 301 }, (_, index) =>
    reservation('address-' + index, 'account-' + index, index)))
  assert.equal(globalLimited.filter(Boolean).length, 300)
  assert.equal((await login(email, password)).status, 429)
  await reset()
  assert.equal((await login(email, password)).status, 200)

  const pendingMail = []
  const deliveries = new Map()
  const mailSettings = {
    pool: () => pool, settings: () => settings, key: () => Buffer.alloc(32),
    mailer: () => async (address, code) => { deliveries.set(address, code) },
    defer: work => { pendingMail.push(work) },
  }
  const accountRequest = (route, path, body, cookie, extraHeaders) =>
    accountHandler(route, mailSettings)(new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...writeHeaders, 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }), ...extraHeaders },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }))
  const adminCookie = cookieOf(await login(admin, adminPassword))
  const memberCookie = cookieOf(await login(email, password))
  await parity('memberForbidden', await accountRequest('members', '/api/admin/users', undefined, memberCookie))
  await parity('memberStats', await accountRequest('stats', '/api/admin/users/stats', undefined, adminCookie))
  const memberRows = await (await accountRequest('members', '/api/admin/users', undefined, adminCookie)).json()
  const member = memberRows.find(row => row.id === id)
  assert.ok(member)
  assert.equal(member.role, 'USER')
  const statusPath = '/api/admin/users/' + id + '/status'
  const change = { status: 'SUSPENDED', revision: member.revision, reason: 'Comparison' }
  const intent = { 'X-TeamFlow-Admin': 'member-status' }
  assert.equal((await accountRequest('status', statusPath, change, adminCookie)).status, 403)
  await parity('statusChange', await accountRequest('status', statusPath, change, adminCookie, intent))
  await parity('statusRetry', await accountRequest('status', statusPath, change, adminCookie, intent))
  await parity('revoked', await me(memberCookie))
  assert.equal((await accountRequest('status', statusPath, { ...change, reason: 'Different' }, adminCookie, intent)).status, 409)
  const audit = await (await accountRequest('auditPage', '/api/admin/audit/page?toStatus=SUSPENDED&limit=1',
    undefined, adminCookie)).json()
  assert.equal(audit.entries[0].targetId, id)
  assert.equal(audit.entries[0].reason, 'Comparison')
  assert.equal((await accountRequest('status', statusPath, { ...change, status: 'ACTIVE', revision: member.revision + 1 },
    adminCookie, intent)).status, 204)
  const firstSession = cookieOf(await login(email, password))
  const otherSession = cookieOf(await login(email, password))
  const replacement = 'replacement-password'
  const changePassword = { currentPassword: password, newPassword: replacement }
  assert.equal((await accountRequest('password', '/api/auth/change-password',
    { ...changePassword, currentPassword: 'wrong' }, firstSession)).status, 400)
  await parity('passwordChange', await accountRequest('password', '/api/auth/change-password', changePassword, firstSession))
  await parity('revoked', await me(firstSession))
  await parity('revoked', await me(otherSession))
  await parity('wrong', await login(email, password))
  await parity('memberLogin', await login(email, replacement))

  const newSignup = (address, code, name = 'New member') => accountRequest('signup', '/api/auth/signup',
    { email: address, code, name, password: replacement })
  await parity('signupInvalid', await newSignup(springCodeEmail, springCode, ''))
  const springIssued = await newSignup(springCodeEmail, springCode)
  assert.equal(springIssued.status, 201)
  const created = await springIssued.json()
  assert.deepEqual(created, { id: created.id, name: 'New member', email: springCodeEmail, message: '회원가입이 완료되었습니다.' })
  assert.equal((await newSignup(springCodeEmail, springCode)).status, 422)
  const requestCode = address => accountRequest('code', '/api/auth/signup/code', { email: address })
  await parity('signupCode', await requestCode(nodeSignupEmail))
  await Promise.all(pendingMail)
  const code = deliveries.get(nodeSignupEmail)
  assert.match(code, /^\d{6}$/)
  const cooldown = await requestCode(nodeSignupEmail)
  assert.equal(cooldown.status, 429)
  assert.ok(Number(cooldown.headers.get('Retry-After')) > 0)
  const wrongCode = code === '000000' ? '000001' : '000000'
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await newSignup(nodeSignupEmail, wrongCode)).status, 422)
  }
  assert.equal((await newSignup(nodeSignupEmail, code)).status, 422)
  const emailKey = createHmac('sha256', Buffer.alloc(32)).update('email:' + nodeSignupEmail).digest('hex')
  await pool.query('UPDATE signup_verifications SET resend_at = clock_timestamp() WHERE email_key = $1', [emailKey])
  await parity('signupCode', await requestCode(nodeSignupEmail))
  await Promise.all(pendingMail)
  assert.equal((await newSignup(nodeSignupEmail, deliveries.get(nodeSignupEmail))).status, 201)
  await parity('signupCode', await requestCode(admin))
  await Promise.all(pendingMail)
  assert.equal(deliveries.has(admin), false)

  if (process.env.TEAMFLOW_TEST_BROWSER === '1') {
    const { browserSmoke } = await import('./browser.mjs')
    await browserSmoke(email, replacement, browserOrigin =>
      Object.fromEntries(['login', 'me', 'logout'].map(route => [
        '/api/auth/' + route,
        authHandler(route, () => authStore(pool), () => authSettings({ TEAMFLOW_AUTH_ORIGINS: browserOrigin })),
      ])))
    console.log('Local HTTPS browser smoke passed')
  }
  console.log('Spring/Node auth, account management, and PostgreSQL integration passed')
} finally {
  await pool.end()
}
