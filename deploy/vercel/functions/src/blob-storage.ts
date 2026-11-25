import { del, get, put } from '@vercel/blob'
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'

export const attachmentPath = (storageKey: string) => 'teamflow/attachments/' + storageKey

export type AttachmentStorage = {
  open: (key: string, signal?: AbortSignal) => Promise<{ size: number; stream: ReadableStream<Uint8Array> } | null>
  token: (key: string, size: number, contentType: string) => Promise<string>
  write: (key: string, file: File, contentType: string, signal?: AbortSignal) => Promise<void>
  remove: (key: string) => Promise<void>
}

export function privateBlob(environment: NodeJS.ProcessEnv): AttachmentStorage | null {
  const token = environment.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) return null
  return {
    async open(key, signal) {
      const result = await get(attachmentPath(key), { access: 'private', token, useCache: false, abortSignal: signal })
      return result?.statusCode === 200 ? { size: result.blob.size, stream: result.stream } : null
    },
    token(key, size, contentType) {
      return generateClientTokenFromReadWriteToken({
        token, pathname: attachmentPath(key), maximumSizeInBytes: size,
        allowedContentTypes: [contentType], validUntil: Date.now() + 180_000,
        allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60,
      })
    },
    async write(key, file, contentType, signal) {
      await put(attachmentPath(key), file, {
        token, access: 'private', contentType, allowOverwrite: false, addRandomSuffix: false,
        cacheControlMaxAge: 60, abortSignal: signal,
      })
    },
    async remove(key) {
      await del(attachmentPath(key), { token, abortSignal: AbortSignal.timeout(3_000) })
    },
  }
}
