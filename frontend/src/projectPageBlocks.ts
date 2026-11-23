import type { Editor } from '@tiptap/core'
import type { Selection } from '@tiptap/pm/state'

export const pageBlockTypes = {
  paragraph: '본문',
  bulletList: '점 목록',
  orderedList: '1. 목록',
  taskList: '할 일',
  codeBlock: '코드 블록',
} as const

export type PageBlockType = keyof typeof pageBlockTypes

const listItems = {
  bulletList: 'listItem',
  orderedList: 'listItem',
  taskList: 'taskItem',
} as const

export function activePageBlock({ $head }: Selection) {
  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const name = $head.node(depth).type.name
    if (name === 'codeBlock' || name === 'bulletList' || name === 'orderedList' || name === 'taskList') return name
  }
  return $head.parent.type.name === 'paragraph' ? 'paragraph' : null
}

export function setPageBlock(editor: Editor, type: PageBlockType, focus = false) {
  const active = activePageBlock(editor.state.selection)
  const chain = editor.chain()
  if (focus) chain.focus()
  if (type === active && editor.state.selection.empty) return chain.run()
  if (type === 'bulletList' || type === 'orderedList' || type === 'taskList') {
    if (type === active) return chain.run()
    return chain.toggleList(type, listItems[type]).run()
  }
  if (active && active in listItems) {
    chain.clearNodes()
    if (type === 'paragraph') return chain.run()
  }
  return chain.setNode(type).run()
}
