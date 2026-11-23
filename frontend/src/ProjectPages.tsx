import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { expandPageAncestors, groupProjectPages, PageRequestError, projectPageApi, resolvePageSelection } from './projectPageApi'
import type { PageTreeEntry, ProjectPage } from './projectPageApi'
import { pageDraftKey, waitForPageSave, writePageDraft } from './projectPageDraft'
import './ProjectPages.css'

const ProjectPageEditor = lazy(() => import('./ProjectPageEditor'))

type TreeState = { status: 'loading' | 'error' } | { status: 'ready'; entries: PageTreeEntry[] }
type DetailState = { status: 'loading' | 'error' | 'missing' } | { status: 'ready'; page: ProjectPage }
type PageForm = { kind: 'create'; parentPageId: number | null } | { kind: 'rename'; pageId: number }

function readSelection(key: string) {
  try {
    const id = Number(window.sessionStorage.getItem(key))
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

function storeSelection(key: string, pageId: number | null) {
  try {
    if (pageId === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, String(pageId))
  } catch {
    return
  }
}

type TreeProps = {
  projectId: number
  groups: ReturnType<typeof groupProjectPages>
  parentId: number | null
  selectedId: number | undefined
  expanded: ReadonlySet<number>
  busy: boolean
  onSelect: (id: number) => void
  onToggle: (id: number) => void
}

function PageTree({ parentId, ...props }: TreeProps) {
  const { projectId, groups, selectedId, expanded, busy, onSelect, onToggle } = props
  return (
    <ul id={parentId === null ? undefined : `tf-page-children-${projectId}-${parentId}`}>
      {groups.get(parentId)?.map(({ id, title, depth }) => {
        const hasChildren = groups.has(id)
        const open = hasChildren && expanded.has(id)
        return (
          <li key={id}>
            <div className="tf-page-row" style={{ paddingInlineStart: `${Math.min(depth, 6) * 0.55}rem` }}>
              {hasChildren ? (
                <button type="button" className="tf-page-toggle" aria-label={`${title} 하위 페이지 ${open ? '접기' : '펼치기'}`}
                  aria-expanded={open} aria-controls={open ? `tf-page-children-${projectId}-${id}` : undefined}
                  onClick={() => onToggle(id)}>{open ? '▾' : '▸'}</button>
              ) : <span aria-hidden="true" />}
              <button type="button" className="tf-page-link" title={title} disabled={busy}
                aria-current={id === selectedId ? 'page' : undefined} onClick={() => onSelect(id)}>{title}</button>
            </div>
            {open && <PageTree {...props} parentId={id} />}
          </li>
        )
      })}
    </ul>
  )
}

function PageDetail({ projectId, draftKey, entry, hasChildren, busy, onCreateChild, onRename, onRemove, onReload, onAccessError }: {
  projectId: number
  draftKey: string
  entry: PageTreeEntry
  hasChildren: boolean
  busy: boolean
  onCreateChild: (parentId: number) => void
  onRename: (page: ProjectPage) => void
  onRemove: (page: ProjectPage) => void
  onReload: () => void
  onAccessError: (status: number) => boolean
}) {
  const [detail, setDetail] = useState<DetailState>({ status: 'loading' })
  const pageActions = useRef<HTMLDetailsElement>(null)
  const menuTrigger = useRef<HTMLElement>(null)
  const pageId = entry.id

  function closeActions(restoreFocus = false) {
    if (pageActions.current) pageActions.current.open = false
    if (restoreFocus) menuTrigger.current?.focus()
  }

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      await waitForPageSave(draftKey)
      if (controller.signal.aborted) return
      const page = await projectPageApi(projectId, controller.signal).get(pageId)
      if (!controller.signal.aborted) setDetail({ status: 'ready', page })
    }
    void load().catch((error: unknown) => {
      if (controller.signal.aborted) return
      const status = error instanceof PageRequestError ? error.status : 0
      if (!onAccessError(status)) setDetail({ status: status === 404 ? 'missing' : 'error' })
    })
    return () => controller.abort()
  }, [draftKey, projectId, pageId, onAccessError])

  return (
    <article className="tf-page-detail" aria-labelledby="tf-page-title">
      <header className="tf-page-header">
        <h2 id="tf-page-title">{detail.status === 'ready' ? detail.page.title : entry.title}</h2>
        {detail.status === 'ready' && (
          <details className="tf-page-actions" ref={pageActions}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) closeActions()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !event.currentTarget.open) return
              event.preventDefault()
              closeActions(true)
            }}>
            <summary ref={(node) => { menuTrigger.current = node }} aria-label="페이지 관리">···</summary>
            <div className="tf-page-action-panel">
              <button type="button" disabled={busy} onClick={() => { closeActions(); onRename(detail.page) }}>이름 변경</button>
              <button type="button" disabled={busy} onClick={() => { closeActions(); onCreateChild(pageId) }}>하위 페이지 추가</button>
              <button type="button" className="tf-danger" disabled={hasChildren || busy}
                aria-describedby={hasChildren ? 'tf-page-delete-help' : undefined}
                onClick={() => { closeActions(true); onRemove(detail.page) }}>삭제</button>
              {hasChildren && <p id="tf-page-delete-help" className="tf-page-hint">하위 페이지를 먼저 삭제해 주세요.</p>}
            </div>
          </details>
        )}
      </header>
      {detail.status === 'loading' && <p className="tf-status" role="status">페이지를 불러오는 중입니다.</p>}
      {(detail.status === 'missing' || detail.status === 'error') && (
        <>
          <p className="tf-error" role="alert">
            {detail.status === 'missing' ? '페이지가 삭제되었거나 접근할 수 없습니다.' : '페이지를 불러오지 못했습니다.'}
          </p>
          <button type="button" onClick={onReload}>다시 불러오기</button>
        </>
      )}
      {detail.status === 'ready' && (
        <Suspense fallback={<p className="tf-status" role="status">본문 편집기를 불러오는 중입니다.</p>}>
          <ProjectPageEditor page={detail.page} draftKey={draftKey} onSessionExpired={() => onAccessError(401)} />
        </Suspense>
      )}
    </article>
  )
}

export default function ProjectPages({ projectId, userId, active, workspace, onOpen, onSessionExpired }: {
  projectId: number
  userId: number
  active: boolean
  workspace: HTMLDivElement | null
  onOpen: () => void
  onSessionExpired: () => void
}) {
  const storageKey = `teamflow:page-selection:${userId}:${projectId}`
  const [tree, setTree] = useState<TreeState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const [blocked, setBlocked] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(new Set<number>())
  const [form, setForm] = useState<PageForm | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const preferredId = useRef<number | null>(null)
  const mutation = useRef<AbortController | null>(null)
  const groups = useMemo(() => groupProjectPages(tree.status === 'ready' ? tree.entries : []), [tree])
  const selected = tree.status === 'ready' ? tree.entries.find(({ id }) => id === selectedId) : undefined

  const onAccessError = useCallback((status: number) => {
    if (status !== 401 && status !== 403) return false
    setBlocked(true)
    if (status === 401) onSessionExpired()
    return true
  }, [onSessionExpired])

  useEffect(() => {
    const controller = new AbortController()
    void projectPageApi(projectId, controller.signal).tree().then((entries) => {
      if (controller.signal.aborted) return
      const id = resolvePageSelection(entries, preferredId.current ?? readSelection(storageKey))
      preferredId.current = id
      storeSelection(storageKey, id)
      setExpanded((previous) => expandPageAncestors(entries, id, previous))
      setSelectedId(id)
      setTree({ status: 'ready', entries })
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      const status = error instanceof PageRequestError ? error.status : 0
      if (status === 404) setBlocked(true)
      else if (!onAccessError(status)) setTree({ status: 'error' })
    })
    return () => controller.abort()
  }, [projectId, revision, storageKey, onAccessError])

  useEffect(() => () => mutation.current?.abort(), [])

  function selectPage(id: number) {
    preferredId.current = id
    storeSelection(storageKey, id)
    setSelectedId(id)
    setForm(null)
    setError('')
    onOpen()
  }

  function togglePage(id: number) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openForm(next: PageForm, initialTitle = '') {
    setError('')
    setTitle(initialTitle)
    setForm(next)
  }

  function reload() {
    setForm(null)
    setError('')
    setTree({ status: 'loading' })
    setRevision((previous) => previous + 1)
  }

  async function mutate(action: (api: ReturnType<typeof projectPageApi>) => Promise<number | null>, failure: string) {
    if (mutation.current) return
    const controller = new AbortController()
    mutation.current = controller
    setBusy(true)
    setError('')
    try {
      const nextId = await action(projectPageApi(projectId, controller.signal))
      if (controller.signal.aborted) return
      preferredId.current = nextId
      storeSelection(storageKey, nextId)
      reload()
    } catch (error) {
      if (controller.signal.aborted) return
      const status = error instanceof PageRequestError ? error.status : 0
      if (onAccessError(status)) return
      if (status === 409) setError('하위 페이지를 먼저 삭제한 뒤 다시 시도해 주세요.')
      else if (status === 404) setError('페이지가 삭제되었거나 접근할 수 없습니다. 목록을 새로고침해 주세요.')
      else setError(failure)
    } finally {
      mutation.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('페이지 제목을 입력해 주세요.')
      return
    }
    if (form.kind === 'rename') {
      void mutate(async (api) => {
        await waitForPageSave(pageDraftKey(userId, projectId, form.pageId))
        return (await api.rename(form.pageId, trimmedTitle)).id
      }, '페이지 이름을 변경하지 못했습니다.')
    } else {
      void mutate(async (api) => (await api.create({
        parentPageId: form.parentPageId, title: trimmedTitle, content: '',
      })).id, '페이지를 만들지 못했습니다. 상위 페이지가 변경되었다면 목록을 새로고침해 주세요.')
    }
  }

  function remove(page: ProjectPage) {
    if (!window.confirm(`‘${page.title}’ 페이지를 삭제하시겠습니까?`)) return
    void mutate(async (api) => {
      const draftKey = pageDraftKey(userId, projectId, page.id)
      await waitForPageSave(draftKey)
      await api.remove(page.id)
      writePageDraft(draftKey, null)
      return page.parentPageId
    }, '페이지를 삭제하지 못했습니다.')
  }

  const accessError = <p className="tf-error" role="alert">이 프로젝트의 문서에 접근할 수 없습니다.</p>

  return (
    <>
      <div className="tf-sidebar-page-tree">
        {blocked ? accessError : <>
          {tree.status === 'loading' && <p className="tf-status" role="status">페이지 목록을 불러오는 중입니다.</p>}
          {tree.status === 'error' && <p className="tf-error" role="alert">페이지 목록을 불러오지 못했습니다.</p>}
          {tree.status === 'ready' && (tree.entries.length === 0 ? <p className="tf-empty">아직 만든 페이지가 없습니다.</p> : (
              <PageTree projectId={projectId} groups={groups} parentId={null} selectedId={active && !form ? selected?.id : undefined} expanded={expanded}
                busy={busy} onSelect={selectPage} onToggle={togglePage} />
          ))}
          {tree.status === 'ready' && (
            <button type="button" className="tf-page-link" disabled={busy} onClick={() => {
              openForm({ kind: 'create', parentPageId: null })
              onOpen()
            }}>+ 새 페이지</button>
          )}
          {tree.status !== 'loading' && (
            <button type="button" className="tf-page-refresh" disabled={busy} onClick={reload}>
              {tree.status === 'error' ? '다시 불러오기' : '목록 새로고침'}
            </button>
          )}
        </>}
      </div>
      {workspace?.dataset.projectId === String(projectId) && createPortal(
        <div className="tf-pages tf-page-workspace">
          {blocked ? accessError : (
            <>
              {busy && <p className="tf-status" role="status">변경 사항을 처리하는 중입니다.</p>}
              {error && <p className="tf-error" role="alert">{error}</p>}
              {form && (
                <form className="tf-page-form" aria-labelledby="tf-page-form-heading" onSubmit={submit}>
                  <h3 id="tf-page-form-heading">
                    {form.kind === 'rename' ? '페이지 이름 변경' : form.parentPageId === null ? '새 페이지' : '하위 페이지 추가'}
                  </h3>
                  {form.kind === 'create' && form.parentPageId !== null && <p>상위 페이지 · {selected?.title}</p>}
                  <label htmlFor="tf-page-form-title">페이지 제목</label>
                  <input id="tf-page-form-title" autoFocus required maxLength={200} value={title} readOnly={busy}
                    onChange={(event) => setTitle(event.target.value)} />
                  <div className="tf-actions">
                    <button type="submit" className="tf-primary" disabled={busy}>{form.kind === 'rename' ? '저장' : '만들기'}</button>
                    <button type="button" disabled={busy} onClick={() => { setForm(null); setError('') }}>취소</button>
                  </div>
                </form>
              )}
              {!form && selected && (
                <PageDetail key={selected.id} projectId={projectId} entry={selected} hasChildren={groups.has(selected.id)}
                  draftKey={pageDraftKey(userId, projectId, selected.id)}
                  busy={busy} onCreateChild={(parentPageId) => openForm({ kind: 'create', parentPageId })}
                  onRename={(page) => openForm({ kind: 'rename', pageId: page.id }, page.title)}
                  onRemove={remove} onReload={reload} onAccessError={onAccessError} />
              )}
              {!form && !selected && (
                tree.status === 'ready' ? (
                  <button type="button" onClick={() => openForm({ kind: 'create', parentPageId: null })}>+ 새 페이지</button>
                ) : tree.status === 'loading' ? (
                  <p className="tf-status" role="status">페이지를 불러오는 중입니다.</p>
                ) : (
                  <button type="button" onClick={reload}>페이지 목록 다시 불러오기</button>
                )
              )}
            </>
          )}
        </div>,
        workspace,
      )}
    </>
  )
}
