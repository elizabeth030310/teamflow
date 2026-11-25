import assert from 'node:assert/strict'
import test from 'node:test'
import { brevoMailer } from '../src/brevo.ts'
import { signupEmail, signupKey } from '../src/signup.ts'

test('signup email validation preserves normalization and rejects malformed addresses', () => {
  assert.equal(signupEmail('Example+tag@EXAMPLE.test'), 'example+tag@example.test')
  assert.equal(signupEmail('사용자@예시.test'), '사용자@예시.test')
  assert.equal(signupEmail('a..b@example.test'), null)
  assert.equal(signupEmail('a@example..test'), null)
  assert.equal(signupEmail('a@example.test\u0000'), null)
  assert.equal(signupEmail('a@example.test/path'), null)
})

test('signup HMAC configuration requires a valid key of at least 32 bytes', () => {
  const key = Buffer.alloc(32, 1)
  assert.deepEqual(signupKey(key.toString('base64')), key)
  assert.equal(signupKey(Buffer.alloc(31).toString('base64')), null)
  assert.equal(signupKey('unavailable'), null)
})

test('Brevo transport keeps the request contract and accepts only HTTP 201', async () => {
  const environment = { TEAMFLOW_BREVO_API_KEY: 'synthetic-key', TEAMFLOW_BREVO_FROM: 'sender@example.test' }
  const sent = brevoMailer(environment, async (url, request) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email')
    assert.equal(request.method, 'POST')
    assert.equal(request.redirect, 'error')
    assert.equal(request.headers['api-key'], environment.TEAMFLOW_BREVO_API_KEY)
    const body = JSON.parse(request.body)
    assert.deepEqual(body.to, [{ email: 'recipient@example.test' }])
    assert.deepEqual(body.sender, { email: environment.TEAMFLOW_BREVO_FROM })
    assert.match(body.textContent, /012345/)
    return new Response(null, { status: 201 })
  })
  await sent('recipient@example.test', '012345')
  assert.equal(brevoMailer({}), null)
  await assert.rejects(brevoMailer(environment, async () => new Response(null, { status: 202 }))(
    'recipient@example.test', '012345'))
})
