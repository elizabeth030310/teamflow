import { put } from '@vercel/blob/client'
import { apiFetch } from './apiFetch.ts'

export async function uploadAttachment(endpoint: string, file: File, signal: AbortSignal) {
  const post = (route: string, body: object) => apiFetch(endpoint + route, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  })
  const reserved = await post('/upload-token', { name: file.name, size: file.size })
  if (!reserved.ok) return reserved
  const { pathname, contentType, clientToken, storageKey } = await reserved.json() as {
    pathname: string; contentType: string; clientToken: string; storageKey: string
  }
  await put(pathname, file, { access: 'private', token: clientToken, contentType, abortSignal: signal })
  return post('/complete', { storageKey })
}
