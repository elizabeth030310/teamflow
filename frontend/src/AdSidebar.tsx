export type AdSidebarProps = {
  enabled: boolean
  ad?: {
    title: string
    description?: string
    href: string
  } | null
}

export default function AdSidebar({ enabled, ad }: AdSidebarProps) {
  if (!enabled || !ad) return null

  const title = ad.title.trim()
  if (!title) return null

  let destination: URL
  try {
    destination = new URL(ad.href)
  } catch {
    return null
  }
  if (destination.protocol !== 'https:' || destination.username || destination.password) return null

  return (
    <aside className="tf-ad-sidebar" aria-label="광고">
      <p className="tf-ad-label">광고</p>
      <a
        href={destination.href}
        target="_blank"
        rel="sponsored noopener noreferrer"
        aria-label={`${title} (새 탭에서 열기)`}
      >
        {title}
      </a>
      {ad.description?.trim() && <p>{ad.description.trim()}</p>}
    </aside>
  )
}
