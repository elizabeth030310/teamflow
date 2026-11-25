import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { compare } from 'bcryptjs'
import { authStore, publicAccount } from './auth-store.ts'

type Route = 'login' | 'me' | 'logout'
type Settings = {
  origins: ReadonlySet<string>
  clientAddress: (request: Request) => string
  legacyLocale?: string
}
const cookieName = '__Host-teamflow-session'
const cookieAttributes = 'Path=/; Secure; HttpOnly; SameSite=Lax'
export const expiredCookie = `${cookieName}=; ${cookieAttributes}; Max-Age=0`
const dummyHash = '$2b$10$hbgKoersuawEtn0ciNlvcOoen4C9lCaRqXsLHLdALPlwWQVws4TRu'
const bcryptHash = /^\$2[aby]\$(?:0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/u

export function authSettings(environment: NodeJS.ProcessEnv): Settings {
  const origins = new Set((environment.TEAMFLOW_AUTH_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean))
  for (const origin of origins) {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) throw new Error('Expected an exact HTTPS origin')
  }
  const legacyLocale = environment.TEAMFLOW_LEGACY_LOGIN_LOCALE
  if (legacyLocale) Intl.getCanonicalLocales(legacyLocale)
  return {
    origins,
    legacyLocale,
    clientAddress(request) {
      const address = environment.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for') : null
      return address && isIP(address) ? address : 'unknown'
    },
  }
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest()
}

export function sessionFrom(request: Request) {
  const candidates = request.headers.get('Cookie')?.split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${cookieName}=`))
  if (candidates?.length !== 1) return null
  const token = candidates[0].slice(cookieName.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? tokenHash(token) : null
}

export function json(status: number, body: object, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'private, no-store')
  return Response.json(body, { status, headers: responseHeaders })
}

export function failure(status: number, error: string, request: Request, cookie?: string, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders)
  if (cookie) headers.set('Set-Cookie', cookie)
  return json(status, { timestamp: new Date().toISOString(), status, error, path: new URL(request.url).pathname }, headers)
}

export function writeAllowed(request: Request, settings: Settings) {
  const origin = new URL(request.url).origin
  const suppliedOrigin = request.headers.get('Origin')
  const site = request.headers.get('Sec-Fetch-Site')
  return settings.origins.has(origin) && request.headers.get('X-TeamFlow-Request') === '1'
    && (suppliedOrigin === null || suppliedOrigin === origin)
    && (site === null || site === 'same-origin')
}

async function credentials(request: Request) {
  const payload = await request.json().catch(() => null)
  if (!payload || typeof payload.email !== 'string' || payload.email.length > 255 ||
      typeof payload.password !== 'string' || payload.password.length > 256 ||
      !payload.email.trim() || !payload.password.trim()) return null
  return { email: payload.email as string, password: payload.password as string }
}

export function authHandler(route: Route, getStore: () => ReturnType<typeof authStore>, getSettings: () => Settings) {
  return async (request: Request): Promise<Response> => {
    const method = route === 'me' ? 'GET' : 'POST'
    const head = route === 'me' && request.method === 'HEAD'
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { Allow: route === 'me' ? 'GET, HEAD, OPTIONS' : 'POST, OPTIONS' } })
    }
    if (request.method !== method && !head) {
      return json(405, { status: 405, error: 'Method Not Allowed' },
        { Allow: route === 'me' ? 'GET, HEAD, OPTIONS' : 'POST, OPTIONS' })
    }

    try {
      const settings = getSettings()
      if (method === 'POST' && !writeAllowed(request, settings)) return failure(403, 'Forbidden', request)
      const oldHash = sessionFrom(request)
      if (route === 'logout') {
        if (oldHash) await getStore().endSession(oldHash)
        return json(200, { message: '로그아웃되었습니다.' }, { 'Set-Cookie': expiredCookie })
      }
      if (route === 'me') {
        const account = oldHash ? await getStore().currentSession(oldHash) : undefined
        const response = account ? json(200, publicAccount(account))
          : failure(401, 'Unauthorized', request, oldHash ? expiredCookie : undefined)
        return head ? new Response(null, { status: response.status, headers: response.headers }) : response
      }

      if (!/^application\/(?:json|[^;\s]+\+json)(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
        return failure(415, 'Unsupported Media Type', request)
      }
      const input = await credentials(request)
      if (!input) return json(400, { message: '입력한 정보를 확인해 주세요.' })

      const store = getStore()
      const trimmedEmail = input.email.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/gu, '')
      const email = trimmedEmail.toLowerCase()
      const legacyEmail = settings.legacyLocale ? trimmedEmail.toLocaleLowerCase(settings.legacyLocale) : email
      if (!await store.reserveLogin(settings.clientAddress(request), email)) {
        return failure(429, 'Too Many Requests', request)
      }
      const account = await store.findLogin(email, legacyEmail)
      if (Buffer.byteLength(input.password, 'utf8') > 72) return failure(401, 'Unauthorized', request)
      const hasValidHash = account !== undefined && bcryptHash.test(account.password)
      const verified = await compare(input.password, hasValidHash ? account.password : dummyHash)
      if (!verified || !hasValidHash || account.account_status !== 'ACTIVE') return failure(401, 'Unauthorized', request)

      const token = randomBytes(32).toString('base64url')
      const current = await store.startSession(account, tokenHash(token), oldHash)
      if (!current) return failure(401, 'Unauthorized', request)
      return json(200, { ...publicAccount(current), message: '로그인에 성공했습니다.' },
        { 'Set-Cookie': `${cookieName}=${token}; ${cookieAttributes}` })
    } catch {
      console.error('TeamFlow: auth request failed')
      const response = failure(503, 'Service Unavailable', request)
      return head ? new Response(null, { status: response.status, headers: response.headers }) : response
    }
  }
}
