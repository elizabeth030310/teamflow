import type { ReactNode } from 'react'

export default function ScrollRegion({ labelId, kind, children }: {
  labelId: string
  kind: 'board' | 'calendar'
  children: ReactNode
}) {
  const hintId = `${labelId}-scroll-hint`

  return (
    <>
      <p id={hintId} className={`tf-scroll-hint tf-${kind}-hint`}>
        화면이 좁을 때 좌우로 스크롤해 더 볼 수 있습니다. 키보드는 영역에 초점을 둔 뒤 방향키를 사용하세요.
      </p>
      <div
        className={`tf-scroll-region tf-${kind}${kind === 'calendar' ? '-scroll' : ''}`}
        role="region"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        tabIndex={0}
      >
        {children}
      </div>
    </>
  )
}
