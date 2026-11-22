import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsxEmit, ModuleKind, transpileModule } from 'typescript'

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === './search' ? './search.ts' : specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)

    const { outputText } = transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext },
    })
    return { format: 'module', shortCircuit: true, source: outputText }
  },
})

const { default: ScrollRegion } = await import('../src/ScrollRegion.tsx')
const { default: AuthPage } = await import('../src/AuthPage.tsx')
const { default: AdminDashboard } = await import('../src/AdminDashboard.tsx')
hook.deregister()

test('board and calendar expose individually named, keyboard-focusable scroll regions', () => {
  for (const [kind, labelId] of [['board', 'board-title-17'], ['calendar', 'task-calendar-month']]) {
    const markup = renderToStaticMarkup(createElement(ScrollRegion, { kind, labelId }, '내용'))
    assert.ok(markup.includes(`id="${labelId}-scroll-hint"`))
    assert.ok(markup.includes(`aria-labelledby="${labelId}"`))
    assert.ok(markup.includes(`aria-describedby="${labelId}-scroll-hint"`))
    assert.match(markup, /role="region"[^>]*tabindex="0"/)
    assert.match(markup, />내용<\/div>/)
  }
})

test('login renders explicit labels, password manager hints, and connection errors', () => {
  const markup = renderToStaticMarkup(createElement(AuthPage, {
    onLogin() {},
    connectionError: '서버 연결을 확인해 주세요.',
  }))

  assert.match(markup, /<label for="auth-email">이메일<\/label>/)
  assert.match(markup, /id="auth-email"[^>]*autoComplete="username"/i)
  assert.match(markup, /<label for="auth-password">비밀번호<\/label>/)
  assert.match(markup, /id="auth-password"[^>]*autoComplete="current-password"/i)
  assert.match(markup, /role="alert">서버 연결을 확인해 주세요\.<\/p>/)
})

test('member administration exposes separate loading states and an audit filter', () => {
  const markup = renderToStaticMarkup(createElement(AdminDashboard, { onSessionExpired() {} }))

  assert.match(markup, /role="status">회원 통계를 불러오는 중입니다/)
  assert.match(markup, /role="status">회원 목록을 불러오는 중입니다/)
  assert.match(markup, /role="status">감사 기록을 불러오는 중입니다/)
  assert.match(markup, /<label>변경 후 상태<select/)
  assert.match(markup, /aria-label="감사 기록 페이지"/)
})
