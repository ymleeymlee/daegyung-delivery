import { NextRequest, NextResponse } from 'next/server'
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
      // assigned(진행중) + completed(앱이 도착·이탈 시 완료처리) 둘 다 시트에 기록. completed 만 빼면 배달 완료분이 통째로 누락됨.
      supabaseServer.from('deliveries').select('*').not('rider_id', 'is', null).in('status', ['assigned', 'completed']),
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
    const todayStartIso = new Date(`${kstDate}T00:00:00+09:00`).toISOString()
    const riders = (riderRows ?? []) as Rider[]
    const deliveries = (deliveryRows ?? []) as Delivery[]
    const clients = (clientRows ?? []) as GopoumClient[]
    const allItems = (itemRows ?? []) as GopoumItem[]
    const activeItems = allItems.filter(i => !i.archived_at)
    // 시트 그리드용: 아직 활성이거나 "오늘" 아카이브된 품목(마감 재시도/부분 실행 대비)까지 포함
    const snapshotItems = allItems.filter(i => !i.archived_at || i.archived_at >= todayStartIso)
    // 위치 그리드는 "오늘" 핑만 (truncate 누락으로 이전날 핑이 남아있어도 오늘 탭 오염 방지)
    const pings = pingRows.filter(p => p.captured_at >= todayStartIso)

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
    const snapshot = buildGrids(riders, deliveries, clients, snapshotItems, pings)

    // 1) 시트 먼저 기록 (배송·고품 기록 실패 시 throw). 파괴적 DB 작업 전에 확정해 데이터 소실 방지.
    //    (구버전은 삭제→truncate→after(시트) 순서라, truncate 가 던지면 DB만 비고 시트엔 안 써져 그날 데이터가 통째로 소실됐음)
    try {
      await writeSnapshot(kstDate, snapshot)
    } catch (e) {
      // 시트 실패 → DB 는 손대지 않고 중단. 원인 해결 후 그대로 재시도 가능.
      return NextResponse.json({ ok: false, stage: 'sheet', error: String(e) }, { status: 500 })
    }

    // 2) 시트 확정 후에만 DB 정리 (조회한 데이터로 잔여 계산 → 재조회 불필요)
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

    // 3) 위치 테이블 정리. 시트가 이미 확정됐으니 실패해도 비치명 — 마감은 성공 처리하고 다음 마감에 정리.
    //    anon/service 모두 이 테이블 DELETE 권한 보유 → security-definer RPC(service_role 전용, anon 폴백 시 permission denied) 의존 제거하고 직접 삭제.
    //    (DELETE 는 dead tuple 남지만 하루 수천 행 수준이라 autovacuum 으로 충분)
    if (pingRows.length > 0) {
      const [pingsDel, locsDel] = await Promise.all([
        supabaseServer.from('location_pings').delete().not('id', 'is', null),
        supabaseServer.from('rider_locations').delete().not('device_id', 'is', null),
      ])
      if (pingsDel.error) console.error('location_pings 삭제 실패(비치명):', pingsDel.error)
      if (locsDel.error) console.error('rider_locations 삭제 실패(비치명):', locsDel.error)
    }

    return NextResponse.json({ ok: true, date: kstDate, closedUntil })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
