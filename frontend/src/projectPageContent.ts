import { Extension, getSchema } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import StarterKit from '@tiptap/starter-kit'
import type { PageContentFormat } from './projectPageApi'

export const maxPageContentLength = 6_000_000

const lineEndings = { '\r': 'cr', '\r\n': 'crlf' } as const
const blockTypesWithLineEnding = ['paragraph', 'heading', 'codeBlock']
const lineEndingAttribute = Extension.create({
  name: 'legacyLineEnding',
  addGlobalAttributes() {
    return [{
      types: blockTypesWithLineEnding,
      attributes: {
        lineEnding: {
          default: null,
          parseHTML: (element) => {
            const value = element.getAttribute('data-line-ending')
            return value === 'cr' || value === 'crlf' ? value : null
          },
          renderHTML: ({ lineEnding }) => lineEnding ? { 'data-line-ending': lineEnding } : {},
        },
      },
    }]
  },
})

export const pageExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false,
    code: false,
    horizontalRule: false,
    link: false,
    strike: false,
  }),
  TaskList,
  TaskItem.configure({ nested: true, a11y: { checkboxLabel: () => '할 일 완료 상태' } }),
  lineEndingAttribute,
]

const schema = getSchema(pageExtensions)
const attributeChecks: Record<string, Record<string, (value: unknown) => boolean>> = {
  codeBlock: { language: (value) => value === null || (typeof value === 'string' && /^[\w+.-]{1,40}$/.test(value)) },
  heading: { level: (value) => value === 1 || value === 2 || value === 3 },
  orderedList: {
    start: (value) => typeof value === 'number' && Number.isSafeInteger(value),
    type: (value) => value === null || value === '1' || value === 'a' || value === 'A' || value === 'i' || value === 'I',
  },
  taskItem: { checked: (value) => typeof value === 'boolean' },
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validNode(value: unknown): boolean {
  if (!object(value) || typeof value.type !== 'string'
    || !Object.hasOwn(schema.nodes, value.type)) return false
  const type = value.type
  if ('text' in value && (value.type !== 'text' || typeof value.text !== 'string')) return false
  if ('attrs' in value) {
    const checks = Object.hasOwn(attributeChecks, value.type) ? attributeChecks[value.type] : {}
    if (!object(value.attrs) || !Object.entries(value.attrs).every(([key, attr]) =>
      key === 'lineEnding' && blockTypesWithLineEnding.includes(type)
        ? attr === null || attr === 'cr' || attr === 'crlf'
        : Object.hasOwn(checks, key) && checks[key](attr))) return false
  }
  if ('marks' in value && (!Array.isArray(value.marks) || !value.marks.every((mark: unknown) =>
    object(mark) && typeof mark.type === 'string' && Object.hasOwn(schema.marks, mark.type)
      && Object.keys(mark).length === 1))) return false
  return !('content' in value) || (Array.isArray(value.content)
    && value.content.every(validNode))
}

export function encodePageContent(document: JSONContent) {
  return JSON.stringify(document, (key, value: unknown) => {
    if (key === 'lineEnding' && value === null) return undefined
    if (key === 'attrs' && object(value) && Object.keys(value).length === 1 && value.lineEnding === null) return undefined
    return value
  })
}

export function decodePageContent(content: string, format?: PageContentFormat): JSONContent {
  const plain = () => {
    const parts = content.split(/(\r\n|\r|\n)/)
    const paragraphs: JSONContent[] = []
    for (let index = 0; index < parts.length; index += 2) {
      const text = parts[index]
      const separator = parts[index + 1]
      const lineEnding = separator === '\r' || separator === '\r\n' ? lineEndings[separator] : null
      paragraphs.push({
        type: 'paragraph',
        ...(lineEnding && { attrs: { lineEnding } }),
        ...(text && { content: [{ type: 'text', text }] }),
      })
    }
    return { type: 'doc', content: paragraphs }
  }
  if (format === 'rich-v1') {
    try {
      const parsed: unknown = JSON.parse(content)
      if (object(parsed) && parsed.type === 'doc' && validNode(parsed)) {
        const document = schema.nodeFromJSON(parsed)
        document.check()
        return document.toJSON()
      }
    } catch {
      return plain()
    }
  }
  return plain()
}
