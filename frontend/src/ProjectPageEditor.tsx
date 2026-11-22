import { useCallback, useEffect, useRef, useState } from 'react'
import { PageRequestError, projectPageApi } from './projectPageApi'
import type { ProjectPage } from './projectPageApi'
import { acknowledgePageSave, isPageDraftPersisted, readPageDraft, trackPageSave, writePageDraft } from './projectPageDraft'

function saveErrorMessage(status: number) {
  if (status === 401) return '로그인 세션이 만료되었습니다. 같은 계정으로 다시 로그인해 주세요.'
  if (status === 403) return '이 페이지를 저장할 권한이 없습니다.'
  if (status === 404) return '페이지가 삭제되었거나 접근할 수 없습니다.'
  if (status === 409) return '서버에서 본문이 변경되었습니다. 작성 내용은 이 탭에 남아 있습니다. 내용을 복사한 뒤 다른 탭에서 서버 본문을 확인해 주세요.'
  if (status === 400) return '본문을 저장할 수 없습니다. 입력 내용을 확인해 주세요.'
  return '본문을 저장하지 못했습니다. 연결을 확인하고 다시 저장해 주세요.'
}

export default function ProjectPageEditor({ page, draftKey, onSessionExpired }: {
  page: ProjectPage
  draftKey: string
  onSessionExpired: () => void
}) {
  const [draft, setDraft] = useState(() => readPageDraft(draftKey))
  const [savedContent, setSavedContent] = useState(page.content)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [errorStatus, setErrorStatus] = useState(0)
  const [autoSave, setAutoSave] = useState(false)
  const [composing, setComposing] = useState(false)
  const [persisted, setPersisted] = useState(() => isPageDraftPersisted(draftKey))
  const mounted = useRef(false)
  const saving = useRef(false)
  const busy = status === 'saving'
  const denied = errorStatus === 401 || errorStatus === 403

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const save = useCallback(async (overwrite = false) => {
    if (saving.current || composing || denied) return
    const current = readPageDraft(draftKey)
    if (!current) return
    saving.current = true
    setAutoSave(false)
    setStatus('saving')
    setErrorStatus(0)
    const operation = async () => {
      const api = projectPageApi(page.projectId, new AbortController().signal)
      const baseContent = overwrite ? (await api.get(page.id)).content : current.baseContent
      const saved = await api.saveContent(page.id, current.content, baseContent)
      return { saved, ...acknowledgePageSave(draftKey, saved.content) }
    }
    try {
      const result = await trackPageSave(draftKey, operation())
      if (!mounted.current) return
      setSavedContent(result.saved.content)
      setDraft(result.next)
      setPersisted(result.persisted)
      setStatus('saved')
    } catch (error) {
      if (!mounted.current) return
      const code = error instanceof PageRequestError ? error.status : 0
      setAutoSave(false)
      setErrorStatus(code)
      setStatus('failed')
      if (code === 401) onSessionExpired()
    } finally {
      saving.current = false
    }
  }, [composing, denied, draftKey, onSessionExpired, page.id, page.projectId])

  useEffect(() => {
    if (!draft || !autoSave || busy || composing || denied) return
    const timer = window.setTimeout(() => { void save() }, 800)
    return () => window.clearTimeout(timer)
  }, [autoSave, busy, composing, denied, draft, save])

  function edit(content: string) {
    const next = { content, baseContent: draft?.baseContent ?? savedContent }
    setPersisted(writePageDraft(draftKey, next))
    setDraft(next)
    setAutoSave(true)
  }

  return (
    <form className="tf-page-editor" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label htmlFor="tf-page-body">페이지 본문</label>
      <textarea id="tf-page-body" rows={12} maxLength={100000} value={draft?.content ?? savedContent}
        readOnly={denied} onChange={(event) => edit(event.target.value)}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        placeholder="본문을 입력해 주세요." />
      <div className="tf-actions">
        <button type="submit" className="tf-primary" disabled={!draft || busy || denied || composing}>본문 저장</button>
        <span className="tf-status" role="status">
          {busy ? '저장 중…' : draft ? '저장되지 않은 변경 사항' : status === 'saved' ? '저장 완료' : ''}
        </span>
      </div>
      {status === 'failed' && <p className="tf-error" role="alert">{saveErrorMessage(errorStatus)}</p>}
      {status === 'failed' && errorStatus === 409 && (
        <button type="button" disabled={composing} onClick={() => {
          if (window.confirm('서버 본문을 이 탭에서 작성한 본문으로 덮어쓰시겠습니까?')) void save(true)
        }}>내 본문으로 덮어쓰기</button>
      )}
      {!persisted && draft && <p className="tf-error" role="alert">임시 보관 공간을 사용할 수 없습니다. 새로고침하거나 탭을 닫기 전에 본문을 저장하거나 복사해 주세요.</p>}
    </form>
  )
}
