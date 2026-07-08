// 시트 실시간 동기화 트리거 (클라이언트 → 서버 API)
// 짧은 시간 내 여러 변경을 묶어 한 번만 호출 (debounce)

const timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {}

export function syncSheet(type: 'delivery' | 'gopoum' | 'both', delayMs = 1500) {
  if (typeof window === 'undefined') return
  if (timers[type]) clearTimeout(timers[type])
  timers[type] = setTimeout(() => {
    fetch('/api/sheets/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
      keepalive: true,
    }).catch(() => {})
  }, delayMs)
}
