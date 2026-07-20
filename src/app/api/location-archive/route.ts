import { NextRequest, NextResponse } from 'next/server'
import { readLocationTab } from '@/lib/googleSheets'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// 라이더별로 그룹화된 아카이브 응답. 색상은 클라이언트가 팔레트로 배정.
export interface ArchiveRider {
  rider_name: string
  points: { lat: number; lng: number; captured_at: string }[]
}
export interface ArchiveResponse {
  date: string
  found: boolean          // 시트/탭이 존재했는지
  riders: ArchiveRider[]
  totalPoints: number
}

// 시트 측정시각("YY-MM-DD HH:MM:SS", KST) → 파싱 가능한 ISO. 5분마킹·구간분리용.
function sheetTimeToIso(s?: string): string {
  if (!s) return ''
  const m = s.trim().match(/^(\d{2})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return s
  const [, yy, mo, dd, hh, mi, ss] = m
  return `20${yy}-${mo}-${dd}T${hh}:${mi}:${ss}+09:00`
}

// GET /api/location-archive?date=YYYY-MM-DD  → 위치-MM 시트 MM-DD 탭에서 로드
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date 파라미터가 필요합니다 (YYYY-MM-DD).' }, { status: 400 })
  }
  const [year, month, day] = date.split('-')
  const grid = await readLocationTab(year, month, day)

  if (grid === null) {
    return NextResponse.json({ date, found: false, riders: [], totalPoints: 0 } satisfies ArchiveResponse)
  }
  // 헤더(첫 행) 스킵 후 라이더별 그룹화
  const byRider = new Map<string, ArchiveRider>()
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i]
    if (!row || row.length < 4) continue
    const [name, capturedAt, latStr, lngStr] = row
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue
    if (!byRider.has(name)) byRider.set(name, { rider_name: name, points: [] })
    byRider.get(name)!.points.push({ lat, lng, captured_at: sheetTimeToIso(capturedAt) })
  }
  const riders = [...byRider.values()].sort((a, b) => a.rider_name.localeCompare(b.rider_name, 'ko'))
  const totalPoints = riders.reduce((s, r) => s + r.points.length, 0)
  return NextResponse.json({ date, found: true, riders, totalPoints } satisfies ArchiveResponse)
}
