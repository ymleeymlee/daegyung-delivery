// dot-separated 시맨틱 버전 비교 (예: "1.9.9" >= "1.9.8" → true)
export function isVersionAtLeast(current: string | null | undefined, required: string): boolean {
  if (!current) return false
  const cur = current.split('.').map(n => parseInt(n, 10)).filter(n => !isNaN(n))
  const req = required.split('.').map(n => parseInt(n, 10)).filter(n => !isNaN(n))
  const n = Math.max(cur.length, req.length)
  for (let i = 0; i < n; i++) {
    const c = cur[i] ?? 0
    const r = req[i] ?? 0
    if (c > r) return true
    if (c < r) return false
  }
  return true
}
