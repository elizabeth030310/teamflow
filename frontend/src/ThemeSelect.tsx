import { useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

function getTheme(): Theme {
  const theme = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme
  return theme === 'light' || theme === 'dark' ? theme : 'system'
}

export default function ThemeSelect() {
  const [theme, setTheme] = useState(getTheme)

  function changeTheme(nextTheme: Theme) {
    setTheme(nextTheme)
    const root = document.documentElement
    if (nextTheme === 'system') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = nextTheme
    }

    try {
      localStorage.setItem('teamflow:theme', nextTheme)
    } catch {
      return
    }
  }

  return (
    <label className="tf-theme-select">
      테마
      <select value={theme} onChange={(event) => changeTheme(event.currentTarget.value as Theme)}>
        <option value="light">라이트</option>
        <option value="dark">다크</option>
        <option value="system">시스템 설정</option>
      </select>
    </label>
  )
}
