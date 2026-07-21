import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { buildGrids, writeSnapshot } from '@/lib/sheetSnapshot'
import type { Rider, Delivery, GopoumClient, GopoumItem, LocationPing } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 오늘 핑만 페이지네이션 수집 (위치 그리드는 당일치만)
async function fetchTodayPings(sinceIso: string): Promise<LocationPing[]> {
  const PAGE = 1000
  const out: LocationPing[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseServer
      .from('location_pings').select('*')
      .gte('captured_at', sinceIso)
      .order('captured_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as LocationPing[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// 시트 업데이트(덮어쓰기) 전용 — DB 는 그대로 두고 그 시점 유효 날짜 탭만 갱신.
// 마감이 아니므로 언제든 반복 실행 가능. 단 23:55~24:00 은 자동 마감 준비시간이라 금지.
// (자정을 넘겨 실행하면 유효 날짜가 다음날이 되어 자동으로 다음날 탭에 기록됨)
export async function GET() {
  try {
    const [{ data: st }, { data: riderRows }, { data: deliveryRows }, { data: clientRows }, { data: itemRows }, { data: deviceRows }] = await Promise.all([
      supabaseServer.from('app_state').select('*'),
      supabaseServer.from('riders').select('*').eq('is_active', true),
      supabaseServer.from('deliveries').select('*').not('rider_id', 'is', null).in('status', ['assigned', 'completed']),
      supabaseServer.from('gopoum_clients').select('*').order('created_at'),
      supabaseServer.from('gopoum_items').select('*'),
      supabaseServer.from('rider_devices').select('device_id,rider_id'),
    ])

    const m: Record<string, string> = {}
    for (const r of (st ?? []) as { key: string; value: string }[]) m[r.key] = r.value
    const offset = parseInt(m.date_offset || '0') || 0
    const effNow = new Date(Date.now() + offset * 86400000)
    const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(effNow)

    // 23:55~24:00 은 자동 마감(23:59)과 겹치지 않도록 업데이트 금지
    const kstHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(effNow)
    const [hh, mi] = kstHM.split(':').map(Number)
    if (hh === 23 && mi >= 55) {
      return NextResponse.json({ ok: false, blocked: true, error: '23:55~24:00 은 자동 마감 준비 시간이라 업데이트가 잠시 막힙니다.' }, { status: 409 })
    }
    const todayStartIso = new Date(`${kstDate}T00:00:00+09:00`).toISOString()

    const riders = (riderRows ?? []) as Rider[]
    const deliveries = (deliveryRows ?? []) as Delivery[]
    const clients = (clientRows ?? []) as GopoumClient[]
    const allItems = (itemRows ?? []) as GopoumItem[]
    // 활성 + 오늘 아카이브된 품목까지 (마감 직후 재업데이트 대비)
    const snapshotItems = allItems.filter(i => !i.archived_at || i.archived_at >= todayStartIso)
    const pings = await fetchTodayPings(todayStartIso)

    // 앱은 device_id 로만 핑 기록 → 기기↔라이더 매핑으로 이름 채움
    const riderNameById = new Map(riders.map(r => [r.id, r.name]))
    const devToRider = new Map<string, { id: string; name: string }>()
    for (const dv of (deviceRows ?? []) as { device_id: string; rider_id: string | null }[]) {
      if (dv.rider_id && riderNameById.has(dv.rider_id)) devToRider.set(dv.device_id, { id: dv.rider_id, name: riderNameById.get(dv.rider_id)! })
    }
    for (const p of pings) {
      const r = p.device_id ? devToRider.get(p.device_id) : undefined
      if (r) { p.rider_id = r.id; p.rider_name = r.name }
      else if (!p.rider_name) p.rider_name = p.device_id ? `미지정(${p.device_id.slice(0, 8)})` : '미지정'
    }

    const snapshot = buildGrids(riders, deliveries, clients, snapshotItems, pings)
    await writeSnapshot(kstDate, snapshot)   // 배송·고품 기록 실패 시 throw
    return NextResponse.json({ ok: true, date: kstDate })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
