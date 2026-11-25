import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = (name) => readFileSync(new URL(`../src/${name}.tsx`, import.meta.url), 'utf8')

test('owner controls resend only pending invitations and block repeated clicks while sending', () => {
  const collaboration = readSource('Collaboration')
  assert.match(collaboration, /isOwner && <ProjectInvitations/)
  assert.match(collaboration, /invitation.status === 'PENDING' && <button/)
  assert.match(collaboration, /disabled=\{resendingId !== null/)
  assert.match(collaboration, /if \(resendLock.current \|\| invitation.status !== 'PENDING'\) return/)
  assert.match(collaboration, /\$\{path\}\/\$\{invitation.id\}\/resend/)
  assert.match(collaboration, /429: '최근에 보낸 초대입니다/)
  assert.match(collaboration, /앱 초대 알림을 다시 보냈습니다/)
})

test('notification updates refresh the real invitation inbox and invitations open that inbox', () => {
  assert.match(readSource('NotificationCenter'), /setSnapshot\(\{ page, inbox \}\)[\s\S]*?onRefreshInvitations\(\)/)
  assert.match(readSource('NotificationCenter'), /if \(item.kind === 'PROJECT_INVITATION'\) onOpenInvitations\(\)/)
  assert.match(readSource('App'), /<InvitationInbox\s+refreshKey=\{invitationRefresh\}/)
  assert.match(readSource('Collaboration'), /useProjectList<Invitation>\('\/invitations', [^\n]+refreshKey\)/)
})
