import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { fromCron } from '@/lib/cronAuth'
import { buildGridsByBranch, writeSnapshot } from '@/lib/sheetSnapshot'
import { fetchAutoActions } from '@/lib/autoActions'
import type { Rider, Delivery, GopoumClient, GopoumItem, LocationPing, Branch } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 마감은 크론 전용 (매일 22:00 KST = 13:00 UTC). URL 직접 접근 차단 — fromCron 참조.
// 각 액션은 app_state.auto_actions.*.close 플래그로 켜기/끄기 가능(설정 페이지).

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

export async function GET(req: NextRequest) {
  if (!fromCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden (cron only)' }, { status: 403 })
  }
  try {
    // 자동 수행 설정 로드 (각 액션 개별 토글). close 플래그만 여기서 사용.
    const auto = await fetchAutoActions(supabaseServer)
    const closedStateFlag = auto.location_share_off.close || auto.delivery_create_block.close

    // 1) 현황 + 상태 조회를 한 번에 병렬 — 스냅샷/잔여/날짜 계산에 공유
    const [{ data: st }, { data: riderRows }, { data: deliveryRows }, { data: clientRows }, { data: itemRows }, { data: deviceRows }, pingRows] = await Promise.all([
      supabaseServer.from('app_state').select('*'),
      supabaseServer.from('riders').select('*').eq('is_active', true),
      supabaseServer.from('deliveries').select('*').not('rider_id', 'is', null).in('status', ['assigned', 'completed']),
      supabaseServer.from('gopoum_clients').select('*').order('created_at'),
      supabaseServer.from('gopoum_items').select('*'),
      supabaseServer.from('rider_devices').select('device_id,rider_id,name,branch,today_first_connected_at'),
      fetchAllPings(),
    ])
    const { data: branchRows } = await supabaseServer.from('branches').select('*').order('sort_order')

    // 유효 날짜(offset 반영) 계산
    const m: Record<string, string> = {}
    for (const r of (st ?? []) as { key: string; value: string }[]) m[r.key] = r.value
    const offset = parseInt(m.date_offset || '0') || 0
    const effNow = new Date(Date.now() + offset * 86400000)
    const nowIso = effNow.toISOString()
    // 06:00 이전 실행은 전날 마감으로 귀속 (Vercel Hobby 크론 최대 1시간 지연 대응).
    const bizAnchor = new Date(effNow.getTime() - 6 * 3600 * 1000)
    const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(bizAnchor)
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
    const snapshotItems = allItems.filter(i => !i.archived_at || i.archived_at >= todayStartIso)
    const pings = pingRows.filter(p => p.captured_at >= todayStartIso)

    // 앱은 device_id 로만 핑을 기록 → rider_devices.name 으로 rider_name 을 채워 스냅샷에 반영
    const riderNameById = new Map(riders.map(r => [r.id, r.name]))
    const deviceList = (deviceRows ?? []) as { device_id: string; rider_id: string | null; name: string | null; branch: string | null; today_first_connected_at: string | null }[]
    const devToRider = new Map<string, { id: string; name: string }>()
    for (const dv of deviceList) {
      const name = dv.name ?? (dv.rider_id && riderNameById.has(dv.rider_id) ? riderNameById.get(dv.rider_id)! : null)
      if (name) devToRider.set(dv.device_id, { id: dv.rider_id ?? '', name })
    }
    const todayRiderIds = new Set(
      deviceList
        .filter(dv => dv.today_first_connected_at != null && dv.rider_id != null)
        .map(dv => dv.rider_id!)
    )
    const todayRiders = riders.filter(r => todayRiderIds.has(r.id))
    for (const p of pings) {
      const r = p.device_id ? devToRider.get(p.device_id) : undefined
      if (r) { if (r.id) p.rider_id = r.id; p.rider_name = r.name }
    }
    const knownPings = pings.filter(p => p.rider_name)

    const branches = (branchRows ?? []) as Branch[]
    const performed: string[] = []

    // 1) 시트 업데이트
    if (auto.sheet_update.close) {
      if (branches.length === 0) {
        return NextResponse.json({ ok: false, stage: 'sheet', error: '등록된 지점이 없습니다' }, { status: 500 })
      }
      const perBranch = buildGridsByBranch(branches, todayRiders, deliveries, clients, snapshotItems, knownPings)
      try {
        for (const b of perBranch) await writeSnapshot(b.label, kstDate, b.data)
      } catch (e) {
        // 시트 실패 → DB 는 손대지 않고 중단. 원인 해결 후 그대로 재시도 가능.
        return NextResponse.json({ ok: false, stage: 'sheet', error: String(e) }, { status: 500 })
      }
      performed.push('sheet_update')
    }

    // 2) DB 정리 (활성화된 것만). 시트가 이미 확정됐거나 시트가 꺼져 있으면 그대로 진행.
    const tasks: PromiseLike<unknown>[] = []
    if (auto.delivery_reset.close) {
      tasks.push(supabaseServer.from('deliveries').delete().not('id', 'is', null))
      performed.push('delivery_reset')
    }
    if (auto.gopoum_reset.close) {
      tasks.push(supabaseServer.from('gopoum_items').update({ archived_at: nowIso }).not('picked_at', 'is', null).is('archived_at', null))
      for (const gc of clients) {
        const rem = activeItems.filter(i => i.gopoum_client_id === gc.id && !i.picked_at).length
        tasks.push(supabaseServer.from('gopoum_clients')
          .update({ total_quantity: rem, started_at: rem > 0 ? tomorrow8am : null })
          .eq('id', gc.id))
      }
      performed.push('gopoum_reset')
    }
    if (closedStateFlag) {
      tasks.push(supabaseServer.from('app_state').upsert({ key: 'closed_until', value: closedUntil }))
      // 라이더 기기 리셋(connected off + 출근시간 초기화)은 마감 상태 진입과 세트로 처리
      tasks.push(supabaseServer.from('rider_devices').update({ connected: false, last_connected_at: null, today_first_connected_at: null }).eq('connected', true))
      if (auto.location_share_off.close) performed.push('location_share_off')
      if (auto.delivery_create_block.close) performed.push('delivery_create_block')
    }
    await Promise.all(tasks)

    // 3) 위치 로그 정리 (활성화 시)
    if (auto.location_log_purge.close && knownPings.length > 0) {
      const [pingsDel, locsDel] = await Promise.all([
        supabaseServer.from('location_pings').delete().not('id', 'is', null),
        supabaseServer.from('rider_locations').delete().not('device_id', 'is', null),
      ])
      if (pingsDel.error) console.error('location_pings 삭제 실패(비치명):', pingsDel.error)
      if (locsDel.error) console.error('rider_locations 삭제 실패(비치명):', locsDel.error)
      performed.push('location_log_purge')
    }

    return NextResponse.json({ ok: true, date: kstDate, closedUntil: closedStateFlag ? closedUntil : null, performed })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
