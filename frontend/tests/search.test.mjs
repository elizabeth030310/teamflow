import assert from 'node:assert/strict'
import test from 'node:test'
import { createSearchMatcher, extractHangulInitials } from '../src/search.ts'

test('extracts Hangul initials while preserving non-Hangul characters', () => {
  assert.equal(extractHangulInitials('가까나다따라마바빠사싸아자짜차카타파힣'), 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ')
  assert.equal(extractHangulInitials('개발 API-189!'), 'ㄱㅂ API-189!')
  assert.equal(extractHangulInitials('개발'.normalize('NFD')), 'ㄱㅂ')
})

test('matches one or more consecutive initials anywhere in a field', () => {
  const matchesGiyeok = createSearchMatcher('ㄱ')
  assert.equal(matchesGiyeok('기획서'), true)
  assert.equal(matchesGiyeok('개발'), true)
  assert.equal(matchesGiyeok('악'), false)
  assert.equal(matchesGiyeok('까'), false)

  const matchesDevelopment = createSearchMatcher(' ㄱㅂ ')
  assert.equal(matchesDevelopment('앱 개발 일정'), true)
  assert.equal(matchesDevelopment('개발'.normalize('NFD')), true)
  assert.equal(createSearchMatcher('\u1100\u1107')('개발'), true)
  assert.equal(matchesDevelopment('발견'), false)
})

test('does not skip characters to join otherwise separate initials', () => {
  const matches = createSearchMatcher('ㄱㅂ')
  for (const field of ['기획 발표', '기-본', '기A본', '기1본', '기획발표', null, undefined]) {
    assert.equal(matches(field), false)
  }
  assert.equal(createSearchMatcher('ㄳ')('각'), false)
  assert.equal(createSearchMatcher('ㄱ발')('개발'), false)
})

test('preserves trimmed case-insensitive literal substring searches and empty queries', () => {
  const field = '앱 개발 API-189'
  assert.equal(createSearchMatcher('발 aPi-18')(field), true)
  assert.equal(createSearchMatcher(' 189 ')(field), true)
  assert.equal(createSearchMatcher('개발')(field), true)
  assert.equal(createSearchMatcher('개 발')(field), false)
  assert.equal(createSearchMatcher('   ')(undefined), true)
})
