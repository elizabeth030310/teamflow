import { STATUS_CODES } from 'node:http'
import type { Pool } from 'pg'
import { accountEntry } from './account-api.ts'
import { attachmentRoutes } from './attachments.ts'
import { privateBlob } from './blob-storage.ts'
import type { AttachmentStorage } from './blob-storage.ts'
import { authStore, transaction } from './auth-store.ts'
import { authSettings, failure, json, sessionFrom, writeAllowed } from './auth.ts'
import { ApiError, first, id, requireProject, requireThat } from './collaboration-data.ts'
import { databasePool } from './database.ts'
import { notificationsApi } from './notifications.ts'
import { projectsApi } from './projects.ts'
import { tasksApi } from './tasks.ts'

const adminRoutes = [
  [/^\/users$/u, accountEntry('members')], [/^\/users\/stats$/u, accountEntry('stats')],
  [/^\/audit$/u, accountEntry('audit')], [/^\/audit\/page$/u, accountEntry('auditPage')],
  [/^\/users\/\d+\/status$/u, accountEntry('status')],
] as const

export function originalApiUrl(request: Request) {
  const url = new URL(request.url)
  if (url.pathname === '/api/collaboration') {
    const path = url.searchParams.get('_teamflowPath') ?? ''
    if (/^(projects|tasks|notifications|admin|hello)(?:\/[a-zA-Z0-9-]+)*\/?$/u.test(path)) {
      url.pathname = '/api/' + path
      url.searchParams.delete('_teamflowPath')
    }
  }
  return url
}

export function collaborationHandler(
  getPool: () => Pool,
  getSettings: () => ReturnType<typeof authSettings>,
  getStorage: () => AttachmentStorage | null = () => privateBlob(process.env),
) {
  return async (incoming: Request): Promise<Response> => {
    const url = originalApiUrl(incoming)
    const request = incoming.url === url.href ? incoming : new Request(url, incoming)
    const match = /^\/api\/(projects|tasks|notifications|admin|hello)(?:\/([a-zA-Z0-9/-]*))?$/u.exec(url.pathname)
    const error = (status: number) => failure(status, STATUS_CODES[status] ?? 'Error', request)
    if (!match) return error(404)
    const route = match[1]
    const parts = (match[2] ?? '').replace(/\/$/u, '').split('/').filter(Boolean)
    if (route === 'admin') {
      const recognized = adminRoutes.find(([pattern]) => pattern.test('/' + parts.join('/')))
      return recognized ? recognized[1].fetch(request) : error(404)
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Cache-Control': 'private, no-store' } })
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return error(405)
    const method = request.method === 'HEAD' ? 'GET' : request.method
    const write = method !== 'GET'
    try {
      if (write && !writeAllowed(request, getSettings())) return error(403)
      const token = sessionFrom(request)
      if (!token) return error(401)
      const pool = getPool()
      const actor = await authStore(pool).currentSession(token)
      if (!actor) return error(401)
      const user = Number(actor.id)
      if (route === 'hello') {
        if (method !== 'GET' || parts.length) return error(404)
        return request.method === 'HEAD' ? new Response(null, { headers: { 'Cache-Control': 'private, no-store' } })
          : json(200, { message: 'Hello TeamFlow!' })
      }
      if (route === 'tasks' && parts[1] === 'attachments') {
        if (write && request.headers.get('Origin') !== url.origin) return error(403)
        const response = await attachmentRoutes(pool, getStorage(), request.method === 'HEAD' ? new Request(url, {
          method: 'GET', headers: request.headers, signal: request.signal,
        }) : request, id(parts[0]), parts.slice(2), user, token)
        if (request.method !== 'HEAD') return response
        await response.body?.cancel()
        return new Response(null, { status: response.status, headers: response.headers })
      }
      let input = {}
      if (write && request.body) {
        if (!/^application\/(?:json|[^;\s]+\+json)(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return error(415)
        const data = await request.json().catch(() => null)
        requireThat(data && typeof data === 'object' && !Array.isArray(data), 400)
        input = data
      }
      if (method === 'GET' && route === 'projects' && parts.length === 2 && parts[1] === 'events') {
        await requireProject(pool, id(parts[0]), user, false)
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } })
      }
      if (method === 'GET' && route === 'notifications' && parts.join('/') === 'events') {
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } })
      }

      const execute = (db: Parameters<typeof projectsApi>[0]) => {
        if (route === 'projects') return projectsApi(db, method, parts, user, input, url.searchParams)
        if (route === 'tasks') return tasksApi(db, method, parts, user, input)
        return notificationsApi(db, method, parts, user, url)
      }
      const [status, body] = write ? await transaction(pool, async client => {
        const active = await first(client, `SELECT 1 FROM public.users account JOIN public.teamflow_sessions session
          ON session.user_id = account.id WHERE session.token_hash = $1 AND account.id = $2
          AND account.account_status = 'ACTIVE' AND account.access_revision = session.access_revision
          AND session.expires_at > clock_timestamp() FOR SHARE OF account`, [token, user])
        requireThat(active, 401)
        return execute(client)
      }) : await execute(pool)
      return status === 204 || request.method === 'HEAD'
        ? new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } })
        : json(status, body!)
    } catch (exception) {
      if (exception instanceof ApiError) return error(exception.status)
      const code = exception && typeof exception === 'object' && 'code' in exception ? exception.code : undefined
      console.error('TeamFlow: collaboration query failed', typeof code === 'string' && /^[A-Z0-9]{5}$/u.test(code) ? code : '')
      return error(500)
    }
  }
}

export const collaboration = { fetch: collaborationHandler(databasePool, () => authSettings(process.env)) }
