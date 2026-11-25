export function startVisiblePolling(refresh: () => void, delay: number) {
  const run = () => {
    if (!document.hidden && navigator.onLine) refresh()
  }
  const timer = window.setInterval(run, delay)
  document.addEventListener('visibilitychange', run)
  window.addEventListener('online', run)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', run)
    window.removeEventListener('online', run)
  }
}
