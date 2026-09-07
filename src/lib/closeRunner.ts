// 마감 자동 수행 실행기. /api/close (크론) 와 /api/close-check (클라이언트) 가 공유.
// idempotent: 하루 한 번만 실제 실행. 실행 시 app_state.last_close_reset_date = 오늘 세팅.

import { supabaseServer } from '@/lib/supabaseServer'
import { buildGridsByBranch, writeSnapshot } from '@/lib/sheetSnapshot'
import { fetchAutoActions } from '@/lib/autoActions'
import type { Rider, Delivery, GopoumClient, GopoumItem, LocationPing, Branch } from '@/types'

const LAST_CLOSE_KEY = 'last_close_reset_date'
const DEFAULT_BUSINESS_CLOSE = '18:00'

function kstNow(): { date: string; hm: string } {
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
  return { date, hm }
}

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

export interface CloseRunResult {
  ran: boolean
  performed?: string[]
  date?: string
  reason?: string
  stage?: string
  error?: string
}

/**
 * 조건 판정 후 마감 액션 실행.
 * - business_close_time 이 지났고
 * - 오늘 이미 실행 안 됐으면
 *   auto_actions.close.* 플래그 켜진 항목들만 실행하고 last_close_reset_date=오늘 마킹.
 */
export async function runCloseIfDue(source: 'cron' | 'client'): Promise<CloseRunResult> {
  const { date: today, hm: nowHm } = kstNow()

  // app_state 한 번에 조회 (business_close_time + last_close_reset_date 확인용)
  const { data: st } = await supabaseServer.from('app_state').select('*')
  const m: Record<string, string> = {}
  for (const r of (st ?? []) as { key: string; value: string }[]) m[r.key] = r.value
  const closeTime = m.business_close_time || DEFAULT_BUSINESS_CLOSE
  const lastRun = m[LAST_CLOSE_KEY]

  if (lastRun === today) {
    return { ran: false, reason: '오늘 이미 실행됨', date: today }
  }
  if (nowHm < closeTime) {
    return { ran: false, reason: `아직 영업 마감 전 (${nowHm} < ${closeTime})`, date: today }
  }

  const auto = await fetchAutoActions(supabaseServer)
  const closedStateFlag = auto.location_share_off.close || auto.delivery_create_block.close

  // 데이터 로드
  const [{ data: riderRows }, { data: deliveryRows }, { data: clientRows }, { data: itemRows }, { data: deviceRows }, pingRows, { data: branchRows }] = await Promise.all([
    supabaseServer.from('riders').select('*').eq('is_active', true),
    supabaseServer.from('deliveries').select('*').not('rider_id', 'is', null).in('status', ['assigned', 'completed']),
    supabaseServer.from('gopoum_clients').select('*').order('created_at'),
    supabaseServer.from('gopoum_items').select('*'),
    supabaseServer.from('rider_devices').select('device_id,rider_id,name,branch,today_first_connected_at'),
    fetchAllPings(),
    supabaseServer.from('branches').select('*').order('sort_order'),
  ])
  const offset = parseInt(m.date_offset || '0') || 0
  const effNow = new Date(Date.now() + offset * 86400000)
  const nowIso = effNow.toISOString()
  // 06:00 이전 실행은 전날 영업일 마감으로 귀속 (크론 지연 대응). client-triggered 시엔 시각이 항상 close_time 이후이니 사실상 무영향.
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

  const riderNameById = new Map(riders.map(r => [r.id, r.name]))
  const deviceList = (deviceRows ?? []) as { device_id: string; rider_id: string | null; name: string | null; branch: string | null; today_first_connected_at: string | null }[]
  const devToRider = new Map<string, { id: string; name: string }>()
  for (const dv of deviceList) {
    const name = dv.name ?? (dv.rider_id && riderNameById.has(dv.rider_id) ? riderNameById.get(dv.rider_id)! : null)
    if (name) devToRider.set(dv.device_id, { id: dv.rider_id ?? '', name })
  }
  const todayRiderIds = new Set(
    deviceList.filter(dv => dv.today_first_connected_at != null && dv.rider_id != null).map(dv => dv.rider_id!)
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
      return { ran: false, stage: 'sheet', error: '등록된 지점이 없습니다', date: kstDate }
    }
    const perBranch = buildGridsByBranch(branches, todayRiders, deliveries, clients, snapshotItems, knownPings)
    try {
      for (const b of perBranch) await writeSnapshot(b.label, kstDate, b.data)
    } catch (e) {
      return { ran: false, stage: 'sheet', error: String(e), date: kstDate }
    }
    performed.push('sheet_update')
  }

  // 2) DB 정리 (활성화된 것만)
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
    tasks.push(supabaseServer.from('rider_devices').update({ connected: false, last_connected_at: null, today_first_connected_at: null }).eq('connected', true))
    if (auto.location_share_off.close) performed.push('location_share_off')
    if (auto.delivery_create_block.close) performed.push('delivery_create_block')
  }
  await Promise.all(tasks)

  // 3) 위치 로그 정리
  if (auto.location_log_purge.close && knownPings.length > 0) {
    const [pingsDel, locsDel] = await Promise.all([
      supabaseServer.from('location_pings').delete().not('id', 'is', null),
      supabaseServer.from('rider_locations').delete().not('device_id', 'is', null),
    ])
    if (pingsDel.error) console.error('location_pings 삭제 실패(비치명):', pingsDel.error)
    if (locsDel.error) console.error('rider_locations 삭제 실패(비치명):', locsDel.error)
    performed.push('location_log_purge')
  }

  // 마커 세팅
  await supabaseServer.from('app_state').upsert({ key: LAST_CLOSE_KEY, value: today })

  console.log(`[close] runCloseIfDue via ${source}: performed=${performed.join(',')}`)
  return { ran: true, performed, date: kstDate }
}
