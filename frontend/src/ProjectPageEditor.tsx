import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { PageRequestError, projectPageApi } from './projectPageApi'
import type { ProjectPage } from './projectPageApi'
import { acknowledgePageSave, isPageDraftPersisted, readPageDraft, trackPageSave, writePageDraft } from './projectPageDraft'
import { decodePageContent, encodePageContent, maxPageContentLength, pageExtensions } from './projectPageContent'
import { pageBlockTypes, activePageBlock, setPageBlock } from './projectPageBlocks'
import type { PageBlockType } from './projectPageBlocks'
import { observePageEditorControls } from './projectPageControls'

const blockOptions = {
  paragraph: { description: '일반 텍스트로 작성', icon: 'M4 5h16M4 10h16M4 15h11M4 20h7' },
  bulletList: { description: '순서 없이 항목 정리', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
  orderedList: { description: '번호를 붙여 순서대로 정리', icon: 'M11 7h9M11 17h9M4 6l2-1v5M4 15a1.5 1.5 0 1 1 2.6 1L4 19h3' },
  taskList: { description: '체크박스로 완료 표시', icon: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 12l3 3 5-6' },
  codeBlock: { description: '코드를 고정폭 글꼴로 표시', icon: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14' },
} satisfies Record<PageBlockType, { description: string; icon: string }>

const blockLabels = { ...pageBlockTypes, orderedList: '번호 목록' }

function ControlIcon({ path, className }: { path: string; className?: string }) {
  return <svg className={className} aria-hidden="true" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
}

function positionBlockOptions(anchor: HTMLButtonElement, options: HTMLDivElement, toolbar: HTMLDivElement) {
  const viewport = window.visualViewport
  const margin = 8
  const gap = 6
  const left = (viewport?.offsetLeft ?? 0) + margin
  const viewportTop = viewport?.offsetTop ?? 0
  const headerHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tf-account-height')) || 0
  const top = Math.max(viewportTop, headerHeight) + margin
  const right = left + (viewport?.width ?? document.documentElement.clientWidth) - margin * 2
  const bottom = viewportTop + (viewport?.height ?? document.documentElement.clientHeight) - margin
  const anchorRect = anchor.getBoundingClientRect()
  const toolbarTop = Math.min(anchorRect.top, toolbar.getBoundingClientRect().top)
  options.style.maxWidth = `${Math.max(0, right - left)}px`
  const availableBelow = Math.max(0, bottom - anchorRect.bottom - gap)
  const availableAbove = Math.max(0, toolbarTop - top - gap)
  const openAbove = options.scrollHeight + 2 > availableBelow && availableAbove > availableBelow
  options.style.maxHeight = `${openAbove ? availableAbove : availableBelow}px`
  const { width, height } = options.getBoundingClientRect()
  options.style.left = `${Math.max(left, Math.min(anchorRect.left, right - width))}px`
  options.style.top = `${openAbove ? toolbarTop - gap - height : anchorRect.bottom + gap}px`
  options.style.visibility = Math.max(availableAbove, availableBelow) > 10
    && anchorRect.bottom > top && anchorRect.top < bottom
    && anchorRect.right > left && anchorRect.left < right ? 'visible' : 'hidden'
}

function saveErrorMessage(status: number) {
  if (status === 401) return '로그인 세션이 만료되었습니다. 같은 계정으로 다시 로그인해 주세요.'
  if (status === 403) return '이 페이지를 저장할 권한이 없습니다.'
  if (status === 404) return '페이지가 삭제되었거나 접근할 수 없습니다.'
  if (status === 409) return '서버에서 본문이 변경되었습니다. 작성 내용은 이 탭에 남아 있습니다. 내용을 복사한 뒤 다른 탭에서 서버 본문을 확인해 주세요.'
  if (status === 400) return '본문을 저장할 수 없습니다. 입력 내용을 확인해 주세요.'
  return '본문을 저장하지 못했습니다. 연결을 확인한 뒤 본문을 편집하거나 Ctrl/⌘+S로 자동 저장을 다시 예약해 주세요.'
}

export default function ProjectPageEditor({ page, draftKey, onSessionExpired }: {
  page: ProjectPage
  draftKey: string
  onSessionExpired: () => void
}) {
  const [draft, setDraft] = useState(() => readPageDraft(draftKey))
  const [initialContent] = useState(() => draft
    ? decodePageContent(draft.content, draft.contentFormat)
    : decodePageContent(page.content, page.contentFormat))
  const [savedPage, setSavedPage] = useState(page)
  const [status, setStatus] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [errorStatus, setErrorStatus] = useState(0)
  const [autoSave, setAutoSave] = useState(false)
  const [composing, setComposing] = useState(false)
  const [persisted, setPersisted] = useState(() => isPageDraftPersisted(draftKey))
  const mounted = useRef(false)
  const saving = useRef(false)
  const composition = useRef(false)
  const surface = useRef<HTMLDivElement>(null)
  const blockButton = useRef<HTMLButtonElement>(null)
  const blockMenu = useRef<HTMLDivElement>(null)
  const formatToolbar = useRef<HTMLDivElement>(null)
  const [blocksOpen, setBlocksOpen] = useState(false)
  const busy = status === 'saving'
  const denied = errorStatus === 401 || errorStatus === 403
  const tooLarge = (draft?.content.length ?? 0) > maxPageContentLength

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const save = useCallback(async (overwrite = false) => {
    if (saving.current || composition.current || denied || (errorStatus === 409 && !overwrite)) return
    const current = readPageDraft(draftKey)
    if (!current || current.content.length > maxPageContentLength) return
    saving.current = true
    setAutoSave(false)
    setStatus('saving')
    setErrorStatus(0)
    const operation = async () => {
      const api = projectPageApi(page.projectId, new AbortController().signal)
      const latest = overwrite ? await api.get(page.id) : null
      const saved = await api.saveContent(page.id, current.content, latest?.content ?? current.baseContent,
        current.contentFormat, latest ? latest.contentFormat : current.baseContentFormat)
      return { saved, ...acknowledgePageSave(draftKey, saved.content, saved.contentFormat) }
    }
    try {
      const result = await trackPageSave(draftKey, operation())
      if (!mounted.current) return
      setSavedPage(result.saved)
      setDraft(result.next)
      setPersisted(result.persisted)
      setStatus('idle')
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
  }, [denied, draftKey, errorStatus, onSessionExpired, page.id, page.projectId])

  useEffect(() => {
    if (!draft || !autoSave || busy || composing || denied || tooLarge || errorStatus === 409) return
    const timer = window.setTimeout(() => { void save() }, 800)
    return () => window.clearTimeout(timer)
  }, [autoSave, busy, composing, denied, draft, errorStatus, save, tooLarge])

  function edit(content: string) {
    const previous = readPageDraft(draftKey)
    const next = {
      content,
      contentFormat: 'rich-v1' as const,
      baseContent: previous?.baseContent ?? savedPage.content,
      baseContentFormat: previous ? previous.baseContentFormat : savedPage.contentFormat,
    }
    setPersisted(writePageDraft(draftKey, next))
    setDraft(next)
    setAutoSave(true)
  }

  const editor = useEditor({
    extensions: pageExtensions,
    content: initialContent,
    shouldRerenderOnTransaction: true,
    injectCSS: true,
    onUpdate: ({ editor }) => edit(encodePageContent(editor.getJSON())),
    editorProps: {
      attributes: {
        id: 'tf-page-body',
        class: 'tf-rich-body',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-readonly': String(denied),
        'aria-labelledby': 'tf-page-body-label',
        'aria-describedby': 'tf-page-editor-help',
      },
      handleDOMEvents: {
        compositionstart: () => {
          composition.current = true
          setComposing(true)
          return false
        },
        compositionend: () => {
          composition.current = false
          setComposing(false)
          return false
        },
        paste: (view, event) => {
          event.preventDefault()
          const text = event.clipboardData?.getData('text/plain')
          if (text && view.editable) view.pasteText(text)
          return true
        },
        drop: (_view, event) => {
          event.preventDefault()
          return true
        },
      },
    },
  })

  useEffect(() => {
    editor?.setEditable(!denied, false)
  }, [denied, editor])

  const selectionHead = editor?.state.selection.head
  const editorDocument = editor?.state.doc
  useLayoutEffect(() => {
    const container = surface.current
    if (!editor || !container) return
    return observePageEditorControls(editor, container)
  }, [editor, selectionHead, editorDocument])

  useLayoutEffect(() => {
    const anchor = blockButton.current
    const options = blockMenu.current
    const toolbar = formatToolbar.current
    const container = surface.current
    if (!blocksOpen || !anchor || !options || !toolbar || !container) return

    const position = () => positionBlockOptions(anchor, options, toolbar)
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !options.contains(event.target)) {
        setBlocksOpen(false)
      }
    }
    const viewport = window.visualViewport
    const observer = new ResizeObserver(position)
    observer.observe(container)
    position()
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    window.addEventListener('pointerdown', dismissOutside)
    viewport?.addEventListener('scroll', position)
    viewport?.addEventListener('resize', position)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
      window.removeEventListener('pointerdown', dismissOutside)
      viewport?.removeEventListener('scroll', position)
      viewport?.removeEventListener('resize', position)
    }
  }, [blocksOpen, editorDocument, selectionHead])

  const activeBlock = editor ? activePageBlock(editor.state.selection) : null
  const formats = editor ? [
    ...([1, 2, 3] as const).map((level) => ({
      name: `제목 ${level}`, text: <>H<sub>{level}</sub></>, shortcut: undefined, active: editor.isActive('heading', { level }),
      run: () => editor.chain().focus().toggleHeading({ level }).run(),
    })),
    { name: '굵게', text: <strong>B</strong>, shortcut: 'Control+B Meta+B', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { name: '기울임', text: <em>I</em>, shortcut: 'Control+I Meta+I', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { name: '밑줄', text: <u>U</u>, shortcut: 'Control+U Meta+U', active: editor.isActive('underline'), run: () => editor.chain().focus().toggleUnderline().run() },
  ] : []

  return (
    <div className="tf-page-editor"
      onKeyDown={(event) => {
        if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 's'
          || event.nativeEvent.isComposing || composition.current) return
        event.preventDefault()
        if (draft && !denied && errorStatus !== 409) setAutoSave(true)
      }}>
      <span id="tf-page-body-label" hidden>페이지 본문</span>
      <div className="tf-rich-editor" ref={surface}>
        <div className="tf-rich-block-picker"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setBlocksOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !blocksOpen) return
            event.preventDefault()
            blockButton.current?.focus()
            setBlocksOpen(false)
          }}>
          <button ref={blockButton} type="button" className="tf-rich-block-toggle"
            aria-label={`블록 유형${activeBlock ? `, 현재 ${blockLabels[activeBlock]}` : ''}`}
            aria-expanded={blocksOpen} aria-controls={blocksOpen ? 'tf-rich-block-options' : undefined}
            title="블록 유형"
            disabled={!editor || denied || composing} onClick={() => setBlocksOpen(!blocksOpen)}>
            <ControlIcon path="M5 9l7 7 7-7" />
          </button>
          {blocksOpen && editor && (
            <div ref={blockMenu} className="tf-rich-block-options" id="tf-rich-block-options" role="group" aria-label="블록 유형 선택">
              {(Object.keys(pageBlockTypes) as PageBlockType[]).map((type) => (
                <button key={type} type="button" aria-labelledby={`tf-rich-block-${type}-label`}
                  aria-describedby={`tf-rich-block-${type}-description`} aria-pressed={type === activeBlock} disabled={denied || composing}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setBlocksOpen(false)
                    setPageBlock(editor, type, true)
                  }}>
                  <span className="tf-rich-block-icon"><ControlIcon path={blockOptions[type].icon} /></span>
                  <span className="tf-rich-block-copy">
                    <span id={`tf-rich-block-${type}-label`}>{blockLabels[type]}</span>
                    <small id={`tf-rich-block-${type}-description`}>{blockOptions[type].description}</small>
                  </span>
                  {type === activeBlock && <ControlIcon className="tf-rich-block-check" path="m5 12 4 4L19 6" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div ref={formatToolbar} className="tf-rich-formats" role="group" aria-label="본문 서식">
          {formats.map(({ name, text, shortcut, active, run }) => (
            <button key={name} type="button" aria-label={name} title={name} aria-keyshortcuts={shortcut}
              aria-pressed={active} disabled={denied || composing}
              onMouseDown={(event) => event.preventDefault()} onClick={run}>{text}</button>
          ))}
        </div>
        <EditorContent editor={editor} />
      </div>
      <p className="tf-page-hint tf-editor-help" id="tf-page-editor-help">
        Ctrl/⌘+B·I·U로 글자 서식을 적용합니다. 붙여넣기는 일반 텍스트로 입력됩니다.
      </p>
      <span className="tf-page-hint tf-editor-save-status" role="status">
        {busy ? '저장 중…' : draft && !autoSave && status === 'idle' && !tooLarge
          ? '저장되지 않은 초안을 복원했습니다. 편집을 재개하거나 Ctrl/⌘+S를 누르면 자동 저장됩니다.' : ''}
      </span>
      {tooLarge && <p className="tf-error" role="alert">본문 저장 용량을 초과했습니다. 자동 저장하려면 일부 내용을 줄여 주세요.</p>}
      {status === 'failed' && <p className="tf-error" role="alert">{saveErrorMessage(errorStatus)}</p>}
      {status === 'failed' && errorStatus === 409 && (
        <button type="button" disabled={composing || tooLarge} onClick={() => {
          if (window.confirm('서버 본문을 이 탭에서 작성한 본문으로 덮어쓰시겠습니까?')) void save(true)
        }}>내 본문으로 덮어쓰기</button>
      )}
      {!persisted && draft && <p className="tf-error" role="alert">임시 보관 공간을 사용할 수 없습니다. 자동 저장이 끝나기 전에 탭을 닫아야 한다면 본문을 복사해 주세요.</p>}
    </div>
  )
}
