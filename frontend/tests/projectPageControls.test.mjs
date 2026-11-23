import assert from 'node:assert/strict'
import test from 'node:test'
import { Editor } from '@tiptap/core'
import { observePageEditorControls } from '../src/projectPageControls.ts'
import { decodePageContent, pageExtensions } from '../src/projectPageContent.ts'

function fixture(context) {
  const observers = []
  const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.notify = callback
      this.disconnect = context.mock.fn()
      observers.push(this)
    }

    observe() {}
  }
  context.after(() => {
    if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver)
    else delete globalThis.ResizeObserver
  })
  const style = new Map()
  const dom = {}
  const container = {
    isConnected: true,
    contains: (node) => node === dom,
    getBoundingClientRect: () => ({ top: 10 }),
    style: { setProperty: style.set.bind(style), removeProperty: style.delete.bind(style) },
  }
  return { container, dom, observers, top: () => style.get('--tf-editor-control-top') }
}

test('a real Tiptap editor without a view can initialize and receive resize callbacks', (context) => {
  const editor = new Editor({
    element: null, extensions: pageExtensions, content: decodePageContent('첫 줄'),
  })
  const { container, observers, top } = fixture(context)
  const stop = observePageEditorControls(editor, container)
  try {
    assert.equal(editor.isDestroyed, true)
    assert.throws(() => editor.view.coordsAtPos, /editor view is not available/)
    observers[0].notify()
    assert.equal(top(), undefined)
  } finally {
    stop()
    editor.destroy()
  }
})

test('controls follow a mounted caret and ignore detached views and old resize callbacks', (context) => {
  const { container, dom, observers, top } = fixture(context)
  const listeners = new Map()
  let caretTop = 25
  const coordsAtPos = context.mock.fn(() => ({ top: caretTop }))
  const editor = {
    isDestroyed: true,
    view: { dom, state: { selection: { head: 7 } }, coordsAtPos },
    on: (event, callback) => listeners.set(event, callback),
    off: (event) => listeners.delete(event),
  }

  const stop = observePageEditorControls(editor, container)
  assert.equal(coordsAtPos.mock.callCount(), 0)
  editor.isDestroyed = false
  listeners.get('mount')()
  assert.equal(top(), '42px')
  assert.deepEqual(coordsAtPos.mock.calls[0].arguments, [7])
  caretTop = 140
  observers[0].notify()
  assert.equal(top(), '130px')
  container.isConnected = false
  observers[0].notify()
  assert.equal(top(), undefined)
  container.isConnected = true
  observers[0].notify()
  editor.isDestroyed = true
  listeners.get('unmount')()
  observers[0].notify()
  assert.equal(top(), undefined)
  stop()
  assert.equal(observers[0].disconnect.mock.callCount(), 1)
  assert.equal(listeners.size, 0)

  editor.isDestroyed = false
  const stopReplacement = observePageEditorControls(editor, container)
  caretTop = 200
  observers[0].notify()
  assert.equal(top(), '130px')
  stopReplacement()
})
