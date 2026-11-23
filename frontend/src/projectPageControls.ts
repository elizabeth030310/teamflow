import type { Editor } from '@tiptap/core'

export function observePageEditorControls(editor: Editor, container: HTMLElement) {
  const property = '--tf-editor-control-top'
  const resetControls = () => container.style.removeProperty(property)
  let observing = true

  const positionControls = () => {
    if (!observing) return
    if (editor.isDestroyed) {
      resetControls()
      return
    }
    const view = editor.view
    if (!container.isConnected || !container.contains(view.dom)) {
      resetControls()
      return
    }
    const caret = view.coordsAtPos(view.state.selection.head)
    const top = caret.top - container.getBoundingClientRect().top
    container.style.setProperty(property, `${Math.max(42, top)}px`)
  }

  editor.on('mount', positionControls)
  editor.on('unmount', resetControls)
  const observer = new ResizeObserver(positionControls)
  observer.observe(container)
  positionControls()
  return () => {
    observing = false
    observer.disconnect()
    editor.off('mount', positionControls)
    editor.off('unmount', resetControls)
    resetControls()
  }
}
