const hangulInitials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const initialsOnly = /^[ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎᄀ-ᄒ]+$/u
const firstHangulSyllable = 0xac00
const syllablesPerInitial = 21 * 28

export function extractHangulInitials(text: string): string {
  return text.normalize('NFC')
    .replace(/[가-힣]/gu, (syllable) =>
      hangulInitials[Math.floor((syllable.charCodeAt(0) - firstHangulSyllable) / syllablesPerInitial)],
    )
    .replace(/[ᄀ-ᄒ]/gu, (initial) => hangulInitials[initial.charCodeAt(0) - 0x1100])
}

export function createSearchMatcher(query: string): (field: string | null | undefined) => boolean {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return () => true

  if (initialsOnly.test(term)) {
    const initials = extractHangulInitials(term)
    return (field) => extractHangulInitials(field ?? '').includes(initials)
  }

  return (field) => (field ?? '').toLocaleLowerCase().includes(term)
}
