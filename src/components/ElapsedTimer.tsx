'use client'

import { useEffect, useState } from 'react'

function formatElapsed(startIso: string): string {
  const diff = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  if (h > 0) return `${h}시간 ${m}분`
  if (m > 0) return `${m}분 ${s}초`
  return `${s}초`
}

export default function ElapsedTimer({ startIso }: { startIso: string }) {
  const [display, setDisplay] = useState(() => formatElapsed(startIso))

  useEffect(() => {
    const id = setInterval(() => setDisplay(formatElapsed(startIso)), 1000)
    return () => clearInterval(id)
  }, [startIso])

  return <span>{display}</span>
}
