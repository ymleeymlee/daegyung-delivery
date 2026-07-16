import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { buildGrids, writeSnapshot } from '@/lib/sheetSnapshot'
import type { Rider, Delivery, GopoumClient, GopoumItem, LocationPing } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// location_pings 전량 조회 (Supabase 기본 1000줄 한도 우회). 라이더 8h × 5s = 5,760/명.
async function fetchAllPings(): Promise<LocationPing[]> {
  const PAGE = 1000
  const out: LocationPing[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseServer
      .from('location_pings')
      .select('*')
      .order('captured_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as LocationPing[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// 마감: 유효 현재일 기준
// - 배송: 대기/배정 → completed (보드 비움)
// - 고품: 수거된 품목 archived(현황에서 제거), 미수거는 유지
// - closed_until = 다음날 06:00 KST 저장 → 그 전까지 마감 상태
export async function GET(_req: NextRequest) {
  try {
    // 1) 현황 + 상태 조회를 한 번에 병렬 — 스냅샷/잔여/날짜 계산에 공유
    // location_pings 는 페이지네이션 필요할 수 있어 별도 헬퍼로 (라이더 8h × 5초 = 5,760/명)
    const [{ data: st }, { data: riderRows }, { data: deliveryRows }, { data: clientRows }, { data: itemRows }, { data: deviceRows }, pingRows] = await Promise.all([
      supabaseServer.from('app_state').select('*'),
      supabaseServer.from('riders').select('*').eq('is_active', true),
      supabaseServer.from('deliveries').select('*').not('rider_id', 'is', null).eq('status', 'assigned'),
      supabaseServer.from('gopoum_clients').select('*').order('created_at'),
      supabaseServer.from('gopoum_items').select('*'),
      supabaseServer.from('rider_devices').select('device_id,rider_id'),
      fetchAllPings(),
    ])

    // 유효 날짜(offset 반영) 계산
    const m: Record<string, string> = {}
    for (const r of (st ?? []) as { key: string; value: string }[]) m[r.key] = r.value
    const offset = parseInt(m.date_offset || '0') || 0
    const effNow = new Date(Date.now() + offset * 86400000)
    const nowIso = effNow.toISOString()
    const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(effNow)
    const [y, mo, d] = kstDate.split('-').map(Number)
    const tomorrow = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10)
    const closedUntil = new Date(`${tomorrow}T06:00:00+09:00`).toISOString()
    const tomorrow8am = new Date(`${tomorrow}T08:00:00+09:00`).toISOString()
    const riders = (riderRows ?? []) as Rider[]
    const deliveries = (deliveryRows ?? []) as Delivery[]
    const clients = (clientRows ?? []) as GopoumClient[]
    const allItems = (itemRows ?? []) as GopoumItem[]
    const activeItems = allItems.filter(i => !i.archived_at)
    const pings = pingRows

    // 앱은 device_id 로만 핑을 기록 → 기기↔라이더 매핑으로 rider_id/rider_name 을 채워 스냅샷에 반영
    const riderNameById = new Map(riders.map(r => [r.id, r.name]))
    const devToRider = new Map<string, { id: string; name: string }>()
    for (const dv of (deviceRows ?? []) as { device_id: string; rider_id: string | null }[]) {
      if (dv.rider_id && riderNameById.has(dv.rider_id)) {
        devToRider.set(dv.device_id, { id: dv.rider_id, name: riderNameById.get(dv.rider_id)! })
      }
    }
    for (const p of pings) {
      const r = p.device_id ? devToRider.get(p.device_id) : undefined
      if (r) { p.rider_id = r.id; p.rider_name = r.name }
      else if (!p.rider_name) p.rider_name = p.device_id ? `미지정(${p.device_id.slice(0, 8)})` : '미지정'
    }

    // 스냅샷 그리드 (동기)
    const snapshot = buildGrids(riders, deliveries, clients, activeItems, pings)

    // 2) DB 정리 전부 병렬 (조회한 데이터로 잔여 계산 → 재조회 불필요)
    await Promise.all([
      // 배송 전체 삭제 (시트에 기록됨)
      supabaseServer.from('deliveries').delete().not('id', 'is', null),
      // 수거된 고품 → archived
      supabaseServer.from('gopoum_items').update({ archived_at: nowIso }).not('picked_at', 'is', null).is('archived_at', null),
      // 업체별 잔여(미수거) 수량 갱신
      ...clients.map(gc => {
        const rem = activeItems.filter(i => i.gopoum_client_id === gc.id && !i.picked_at).length
        return supabaseServer.from('gopoum_clients')
          .update({ total_quantity: rem, started_at: rem > 0 ? tomorrow8am : null })
          .eq('id', gc.id)
      }),
      // 마감 상태 저장
      supabaseServer.from('app_state').upsert({ key: 'closed_until', value: closedUntil }),
    ])

    // 위치 테이블은 시트 기록됐으니 초기화 (핑 없으면 이미 비어있으니 스킵)
    if (pings.length > 0) {
      await Promise.all([
        supabaseServer.from('location_pings').delete().not('id', 'is', null),
        supabaseServer.from('rider_locations').delete().not('rider_id', 'is', null),
      ])
    }

    // 시트 저장(느린 Google API)은 응답 후 백그라운드 → 마감 즉시 완료
    after(async () => {
      try { await writeSnapshot(kstDate, snapshot) }
      catch (e) { console.error('시트 스냅샷 저장 실패:', e) }
    })

    return NextResponse.json({ ok: true, date: kstDate, closedUntil })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
