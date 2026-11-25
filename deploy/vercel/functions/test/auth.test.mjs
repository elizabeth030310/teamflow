import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import collaboration from '../api/collaboration.ts'
import signupCode from '../api/auth/signup/code.ts'
import login from '../api/auth/login.ts'
import logout from '../api/auth/logout.ts'
import me from '../api/auth/me.ts'
import { authSettings } from '../src/auth.ts'

const origin = 'https://teamflow.example.test'

test('isolated Preview serves local functions and has no upstream rewrite', async () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.equal(config.outputDirectory, 'public')
  assert.ok(config.rewrites.every(({ destination }) => destination.startsWith('/api/collaboration?')))
  assert.equal(config.routes, undefined)
  assert.equal((await signupCode.fetch(new Request(origin + '/api/auth/signup/code'))).status, 405)
  assert.equal((await collaboration.fetch(new Request(origin + '/api/admin/audit/page'))).status, 401)
  assert.equal((await collaboration.fetch(new Request(origin + '/api/admin/users/1/status'))).status, 405)
})

test('Vercel auth entries expose the expected methods', async () => {
  const unsupportedLogin = await login.fetch(new Request(origin + '/api/auth/login'))
  const unsupportedLogout = await logout.fetch(new Request(origin + '/api/auth/logout'))
  const unsupportedMe = await me.fetch(new Request(origin + '/api/auth/me', { method: 'POST' }))
  for (const response of [unsupportedLogin, unsupportedLogout, unsupportedMe]) {
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
  assert.equal(unsupportedLogin.headers.get('Allow'), 'POST, OPTIONS')
  assert.equal(unsupportedMe.headers.get('Allow'), 'GET, HEAD, OPTIONS')
  assert.equal((await me.fetch(new Request(origin + '/api/auth/me'))).status, 401)
})

test('configured origins must be exact and HTTPS', () => {
  assert.deepEqual([...authSettings({ TEAMFLOW_AUTH_ORIGINS: origin }).origins], [origin])
  for (const invalid of ['*', origin + '/account', origin.replace('https:', 'http:')]) {
    assert.throws(() => authSettings({ TEAMFLOW_AUTH_ORIGINS: invalid }))
  }
})

test('only Vercel requests use the platform-provided client address', () => {
  const request = new Request(origin, {
    headers: { 'x-vercel-forwarded-for': '192.0.2.10', 'x-forwarded-for': '192.0.2.20' },
  })
  assert.equal(authSettings({ VERCEL: '1' }).clientAddress(request), '192.0.2.10')
  assert.equal(authSettings({}).clientAddress(request), 'unknown')
  assert.equal(authSettings({ VERCEL: '1' }).clientAddress(new Request(origin, {
    headers: { 'x-vercel-forwarded-for': '192.0.2.10, 192.0.2.20' },
  })), 'unknown')
})
