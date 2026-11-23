import { apiFetch } from './apiFetch.ts'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

type Attachment = {
  id: number
  uploaderId: number
  displayName: string
  sizeBytes: number
}

type Action =
  | { type: 'upload'; file: File }
  | { type: 'download' | 'delete'; attachment: Attachment }

const maxFileSize = 10 * 1024 * 1024
const allowedExtensions = /\.(pdf|png|jpe?g)$/i
const sizeFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 })

function formatSize(bytes: number) {
  if (bytes < 1024) return `${sizeFormat.format(bytes)} B`
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KiB`
  return `${sizeFormat.format(bytes / (1024 * 1024))} MiB`
}

function validationError(file: File | null) {
  if (!file) return ''
  if (!file.size) return '빈 파일은 첨부할 수 없습니다.'
  if (file.size > maxFileSize) return '파일은 10 MiB 이하여야 합니다.'
  if (!allowedExtensions.test(file.name)) return 'PDF, PNG, JPEG 파일만 첨부할 수 있습니다.'
  return ''
}

function saveDownload(blob: Blob, displayName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = displayName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function requestError(status: number, type: Action['type']) {
  if (status === 413) return '파일은 10 MiB 이하여야 합니다.'
  if (status === 415) return '파일 형식을 확인해 주세요. PDF, PNG, JPEG만 첨부할 수 있습니다.'
  if (status === 503) return '첨부파일 저장소를 사용할 수 없습니다.'
  if (status === 403) return '이 첨부파일 작업을 수행할 권한이 없습니다.'
  if (status === 404) return '카드 또는 첨부파일을 찾을 수 없습니다.'
  if (type === 'upload') return '파일을 첨부하지 못했습니다.'
  if (type === 'delete') return '첨부파일을 삭제하지 못했습니다.'
  return '첨부파일을 다운로드하지 못했습니다.'
}

export default function TaskAttachments({ taskId, userId, revision, connectionRevision, onSessionExpired }: {
  taskId: number
  userId: number
  revision: number
  connectionRevision: number
  onSessionExpired: () => void
}) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<Action['type'] | null>(null)
  const [localRevision, setLocalRevision] = useState(0)
  const activeAction = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const endpoint = `/api/tasks/${taskId}/attachments`
  const inputId = `task-attachment-file-${taskId}`
  const fileError = validationError(file)

  useEffect(() => {
    const interval = window.setInterval(() => setLocalRevision((previous) => previous + 1), 12_000)
    return () => {
      window.clearInterval(interval)
      activeAction.current?.abort()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadAttachments() {
      try {
        const response = await fetch(endpoint, {
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })
        if (controller.signal.aborted) return
        if (response.status === 401) {
          onSessionExpired()
          return
        }
        if (response.status === 403 || response.status === 404) {
          setAttachments(null)
          setLoadError('이 카드의 첨부파일에 접근할 수 없습니다.')
          return
        }
        if (!response.ok) throw new Error()
        const list = await response.json() as Attachment[]
        if (controller.signal.aborted) return
        setAttachments(list)
        setLoadError('')
      } catch {
        if (!controller.signal.aborted) setLoadError('첨부파일 목록을 불러오지 못했습니다.')
      }
    }

    void loadAttachments()
    return () => controller.abort()
  }, [endpoint, revision, connectionRevision, localRevision, onSessionExpired])

  async function runAction(action: Action) {
    if (activeAction.current) return
    const controller = new AbortController()
    activeAction.current = controller
    setBusy(action.type)
    setActionError('')
    setNotice('')

    try {
      let response: Response
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
      if (action.type === 'upload') {
        const form = new FormData()
        form.append('file', action.file)
        response = await apiFetch(endpoint, { method: 'POST', credentials: 'include', body: form, signal })
      } else {
        const itemUrl = `${endpoint}/${action.attachment.id}`
        const downloading = action.type === 'download'
        response = await apiFetch(downloading ? `${itemUrl}/download` : itemUrl, {
          method: downloading ? 'GET' : 'DELETE',
          credentials: 'include',
          cache: 'no-store',
          signal,
        })
      }

      if (controller.signal.aborted) return
      if (response.status === 401) {
        onSessionExpired()
        return
      }
      if (!response.ok) {
        setActionError(requestError(response.status, action.type))
        return
      }

      if (action.type === 'download') {
        const blob = await response.blob()
        if (!controller.signal.aborted) saveDownload(blob, action.attachment.displayName)
      } else if (action.type === 'upload') {
        if (input.current) input.current.value = ''
        setFile(null)
        setNotice('파일을 첨부했습니다.')
      } else {
        setNotice('첨부파일을 삭제했습니다.')
      }
    } catch {
      if (!controller.signal.aborted) setActionError(requestError(0, action.type))
    } finally {
      activeAction.current = null
      if (!controller.signal.aborted) {
        setBusy(null)
        setLocalRevision((previous) => previous + 1)
      }
    }
  }

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (file && !fileError) void runAction({ type: 'upload', file })
  }

  return (
    <section
      className="tf-task-attachments"
      id={`task-attachments-${taskId}`}
      aria-labelledby={`attachments-title-${taskId}`}
    >
      <h5 id={`attachments-title-${taskId}`}>첨부파일</h5>
      {loadError && (
        <p className="tf-error" role="alert">
          {loadError}{' '}
          <button type="button" onClick={() => setLocalRevision((previous) => previous + 1)}>다시 불러오기</button>
        </p>
      )}
      {attachments === null && !loadError && <p role="status">첨부파일을 불러오는 중…</p>}
      {attachments?.length === 0 && <p>아직 첨부파일이 없습니다.</p>}
      {!!attachments?.length && (
        <ul>
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <p>{attachment.displayName} · {formatSize(attachment.sizeBytes)}</p>
              <div className="tf-attachment-actions">
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={`${attachment.displayName} 다운로드`}
                  onClick={() => void runAction({ type: 'download', attachment })}
                >
                  다운로드
                </button>
                {attachment.uploaderId === userId && (
                  <button
                    type="button"
                    className="tf-danger"
                    disabled={busy !== null}
                    aria-label={`${attachment.displayName} 삭제`}
                    onClick={() => {
                      if (window.confirm(`${attachment.displayName} 파일을 삭제할까요?`)) {
                        void runAction({ type: 'delete', attachment })
                      }
                    }}
                  >
                    삭제
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {actionError && <p className="tf-error" role="alert">{actionError}</p>}
      {notice && <p role="status">{notice}</p>}
      {busy === 'download' && <p role="status">다운로드를 준비하는 중…</p>}
      {busy === 'delete' && <p role="status">첨부파일을 삭제하는 중…</p>}
      {attachments !== null && (
        <form onSubmit={submitUpload}>
          <label htmlFor={inputId}>파일 선택</label>
          <p id={`${inputId}-hint`}>PDF, PNG, JPEG · 최대 10 MiB</p>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            aria-describedby={`${inputId}-hint`}
            aria-invalid={!!fileError}
            disabled={busy !== null}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setActionError('')
              setNotice('')
            }}
          />
          {fileError && <p className="tf-error" role="alert">{fileError}</p>}
          <button type="submit" className="tf-primary" disabled={!!busy || !file || !!fileError}>
            {busy === 'upload' ? '첨부 중…' : '파일 첨부'}
          </button>
        </form>
      )}
    </section>
  )
}
