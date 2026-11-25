import { waitUntil } from '@vercel/functions'
import { STATUS_CODES } from 'node:http'
import type { Pool } from 'pg'
import { authStore } from './auth-store.ts'
import { authSettings, expiredCookie, failure, json, sessionFrom, writeAllowed } from './auth.ts'
import { accountStatus, auditEntries, changePassword, changeStatus, members, memberStats } from './account-management.ts'
import { brevoMailer } from './brevo.ts'
import { signupEmail, signupKey, signupStore, SignupThrottle } from './signup.ts'
import { databasePool } from './database.ts'

type Route = 'signup' | 'code' | 'password' | 'members' | 'stats' | 'audit' | 'auditPage' | 'status'
type Dependencies = {
  pool: () => Pool
  settings: () => ReturnType<typeof authSettings>
  key: () => Buffer | null
  mailer: () => ReturnType<typeof brevoMailer>
  defer: (work: Promise<void>) => void
}
const maxBigint = '9223372036854775807'

function long(input: string) {
  if (!/^\+?[0-9]{1,19}$/u.test(input)) return null
  const number = BigInt(input)
  return number <= BigInt(maxBigint) && number > 0n ? number.toString() : null
}

function jsonRequest(request: Request) {
  return /^application\/(?:json|[^;\s]+\+json)(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')
}

function validPassword(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0
}

export function accountHandler(route: Route, dependencies: Dependencies) {
  return async (request: Request) => {
    const isWrite = ['signup', 'code', 'password', 'status'].includes(route)
    const method = isWrite ? 'POST' : 'GET'
    const head = !isWrite && request.method === 'HEAD'
    const sendFailure = (status: number, headers?: HeadersInit) =>
      failure(status, STATUS_CODES[status] ?? 'Error', request, undefined, headers)
    const handle = async (): Promise<Response> => {
      const allowed = isWrite ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS'
      if (request.method === 'OPTIONS') return new Response(null, { headers: { Allow: allowed } })
      if (request.method !== method && !head) return sendFailure(405, { Allow: allowed })

      const settings = dependencies.settings()
      if (isWrite && !writeAllowed(request, settings)) return sendFailure(403)
      const publicRoute = route === 'code' || route === 'signup'
      const session = sessionFrom(request)
      if (!publicRoute && !session) return sendFailure(401)
      const pool = dependencies.pool()
      const user = session && !publicRoute ? await authStore(pool).currentSession(session) : undefined
      if (!publicRoute && !user) return sendFailure(401)
      if (!publicRoute && route !== 'password' && user?.role !== 'ADMIN') return sendFailure(403)

      if (isWrite && !jsonRequest(request)) return sendFailure(415)
      const input = isWrite ? await request.json().catch(() => null) : null

      if (publicRoute) {
        const invalid = () => json(400, { message: '입력한 정보를 확인해 주세요.' })
        const email = signupEmail(input?.email)
        if (!email) return invalid()
        const key = dependencies.key()
        if (route === 'code') {
          const mail = dependencies.mailer()
          if (!mail || !key) return sendFailure(503)
          const code = await signupStore(pool, key).issue(email, settings.clientAddress(request))
          if (code) dependencies.defer(Promise.resolve().then(() => mail(email, code)).catch(() => {
            console.warn('TeamFlow: signup code delivery failed')
          }))
          return json(202, { resendAfterSeconds: 60 })
        }
        if (typeof input.name !== 'string' || input.name.length > 50 || !input.name.trim() ||
            !validPassword(input.password) || input.password.length < 8 ||
            typeof input.code !== 'string' || !/^[0-9]{6}$/u.test(input.code)) return invalid()
        if (Buffer.byteLength(input.password) > 72) return sendFailure(400)
        if (!key) return sendFailure(503)
        const account = await signupStore(pool, key).complete(email, input.name.trim(), input.password, input.code)
        if (!account) return sendFailure(422)
        return json(201, { ...account, id: Number(account.id), message: '회원가입이 완료되었습니다.' })
      }

      if (route === 'password' && user && session) {
        const current = input?.currentPassword
        const replacement = input?.newPassword
        if (!validPassword(current) || !validPassword(replacement)) {
          return json(400, { message: '입력한 정보를 확인해 주세요.' })
        }
        if ([...replacement].length < 8 || Buffer.byteLength(replacement) > 72) return sendFailure(400)
        const status = await changePassword(pool, session, Number(user.id), current, replacement)
        if (status !== 200) return sendFailure(status)
        return json(200, { message: '비밀번호가 변경되었습니다. 다시 로그인해 주세요.' }, { 'Set-Cookie': expiredCookie })
      }

      if (route === 'members') return json(200, await members(pool))
      if (route === 'stats') return json(200, await memberStats(pool))
      if (route === 'audit') {
        const rows = await auditEntries(pool, maxBigint, '', 100)
        return json(200, rows.map(row => row.entry))
      }

      const url = new URL(request.url)
      if (route === 'auditPage') {
        const cursor = long(url.searchParams.get('cursor') || maxBigint)
        const rawLimit = url.searchParams.get('limit') || '25'
        const limit = Number(rawLimit)
        const status = url.searchParams.get('toStatus') ?? ''
        if (!cursor || !/^\+?\d+$/u.test(rawLimit) || limit < 1 || limit > 100 || (status && !accountStatus(status))) {
          return sendFailure(400)
        }
        const rows = await auditEntries(pool, cursor, status, limit + 1)
        return json(200, { entries: rows.slice(0, limit).map(row => row.entry), nextCursor: rows[limit]?.cursor ?? null })
      }

      if (request.headers.get('X-TeamFlow-Admin') !== 'member-status') return sendFailure(403)
      const id = long(/^\/api\/admin\/users\/([^/]+)\/status\/?$/u.exec(url.pathname)?.[1] ?? '')
      const reason = typeof input?.reason === 'string' ? input.reason.trim() : ''
      if (!session || !id || !accountStatus(input?.status) || !Number.isSafeInteger(input.revision) ||
          input.revision < 0 || !reason || input.reason.length > 300) return sendFailure(400)
      const status = await changeStatus(pool, session, id, input.status, input.revision, reason)
      return status === 204 ? new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } }) : sendFailure(status)
    }

    let response: Response
    try {
      response = await handle()
    } catch (error) {
      if (error instanceof SignupThrottle) return sendFailure(429, { 'Retry-After': String(error.seconds) })
      console.error('TeamFlow: account request failed')
      response = sendFailure(503)
    }
    return head ? new Response(null, { status: response.status, headers: response.headers }) : response
  }
}

export function accountEntry(route: Route) {
  return {
    fetch: accountHandler(route, {
      pool: databasePool,
      settings: () => authSettings(process.env),
      key: () => signupKey(process.env.TEAMFLOW_SIGNUP_HMAC_KEY),
      mailer: () => brevoMailer(process.env),
      defer: waitUntil,
    }),
  }
}
