import assert from 'node:assert/strict'
import test from 'node:test'
import readiness from '../api/ready.ts'
import { databaseUrl } from '../src/database.ts'
import { readinessHandler } from '../src/readiness.ts'

const endpoint = 'https://preview.example/api/ready'

test('GET reports success without caching', async () => {
  const fetch = readinessHandler(async () => {})
  const response = await fetch(new Request(endpoint))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { status: 'ready' })
})

test('database failure returns a generic 503', async () => {
  const fetch = readinessHandler(async () => { throw new Error('private connection detail') })
  const response = await fetch(new Request(endpoint))

  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { status: 'unavailable' })
})

test('other methods never query the database', async () => {
  let queried = false
  const fetch = readinessHandler(async () => { queried = true })
  const response = await fetch(new Request(endpoint, { method: 'POST' }))

  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
  assert.equal(queried, false)
})

test('only explicit preview connection settings are accepted', () => {
  const url = 'postgresql://app:fixture@db.example/teamflow'
  assert.equal(databaseUrl({ TEAMFLOW_PREVIEW_DATABASE_URL: url }), url)
  assert.throws(() => databaseUrl({ DATABASE_URL: url }))
  assert.throws(() => databaseUrl({ TEAMFLOW_PREVIEW_DATABASE_URL: url, VERCEL_ENV: 'production' }))
  assert.throws(() => databaseUrl({ TEAMFLOW_PREVIEW_DATABASE_URL: url + '?sslmode=disable' }))
  assert.throws(() => databaseUrl({ TEAMFLOW_PREVIEW_DATABASE_URL: 'https://db.example' }))
  assert.throws(() => databaseUrl({ TEAMFLOW_PRODUCTION_DATABASE_URL: url, VERCEL_ENV: 'production' }))
  assert.throws(() => databaseUrl({ TEAMFLOW_PREVIEW_DATABASE_URL: url, TEAMFLOW_ENABLE_PRODUCTION: '1', VERCEL_ENV: 'production' }))
  assert.equal(databaseUrl({ TEAMFLOW_PRODUCTION_DATABASE_URL: url, TEAMFLOW_ENABLE_PRODUCTION: '1', VERCEL_ENV: 'production' }), url)
})

test('the actual Vercel entry point returns 503 when marked as production', async () => {
  const previous = process.env.VERCEL_ENV
  process.env.VERCEL_ENV = 'production'
  try {
    const response = await readiness.fetch(new Request(endpoint))
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { status: 'unavailable' })
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = previous
  }
})
