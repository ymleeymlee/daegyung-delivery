import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { buildGridsByBranch, writeSnapshot } from '@/lib/sheetSnapshot'
import { upsertUndergroundEntries, type UndergroundEntry } from '@/lib/googleSheets'
import {
  fetchAutoActions, getLastMidnightResetDate, setLastMidnightResetDate, kstToday,
} from '@/lib/autoActions'
import type { Rider, Delivery, GopoumClient, GopoumItem, LocationPing, Branch } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 다음날 00시 자동 수행 엔드포인트. 크론 없이 클라이언트(Nav 등)에서 매 페이지 로드 시 호출.
// 하루에 한 번만 실행되도록 서버사이드 idempotent (app_state.last_midnight_reset_date).
// 인증 없음 — 파괴적 액션은 auto_actions.midnight.* 플래그가 켜진 항목만.
export async function GET() {
  try {
    const today = kstToday()
    const last = await getLastMidnightResetDate(supabaseServer)
    if (last === today) {
      return NextResponse.json({ ok: true, skipped: true, reason: '이미 오늘 실행됨', last })
    }

    const auto = await fetchAutoActions(supabaseServer)
    // midnight 플래그가 하나도 안 켜져 있으면 마커만 갱신하고 종료 (매번 조회 방지)
    const anyEnabled = Object.values(auto).some(v => v.midnight)
    if (!anyEnabled) {
      await setLastMidnightResetDate(supabaseServer, today)
      return NextResponse.json({ ok: true, performed: [], reason: '활성화된 다음날 항목 없음' })
    }

    const closedStateFlag = auto.location_share_off.midnight || auto.delivery_create_block.midnight
    const performed: string[] = []

    // 시트 업데이트 활성 → 데이터 로드 (다른 액션도 이 데이터 재사용)
    let sheetData: {
      branches: Branch[]
      todayRiders: Rider[]
      deliveries: Delivery[]
      clients: GopoumClient[]
      snapshotItems: GopoumItem[]
      knownPings: LocationPing[]
    } | null = null

    if (auto.sheet_update.midnight) {
      const [{ data: st }, { data: riderRows }, { data: deliveryRows }, { data: clientRows }, { data: itemRows }, { data: deviceRows }, { data: pingRows }, { data: branchRows }] = await Promise.all([
        supabaseServer.from('app_state').select('*'),
        supabaseServer.from('riders').select('*').eq('is_active', true),
        supabaseServer.from('deliveries').select('*').not('rider_id', 'is', null).in('status', ['assigned', 'completed']),
        supabaseServer.from('gopoum_clients').select('*').order('created_at'),
        supabaseServer.from('gopoum_items').select('*'),
        supabaseServer.from('rider_devices').select('device_id,rider_id,name,branch,today_first_connected_at'),
        supabaseServer.from('location_pings').select('*').order('captured_at', { ascending: true }),
        supabaseServer.from('branches').select('*').order('sort_order'),
      ])
      const m: Record<string, string> = {}
      for (const r of (st ?? []) as { key: string; value: string }[]) m[r.key] = r.value
      const offset = parseInt(m.date_offset || '0') || 0
      const effNow = new Date(Date.now() + offset * 86400000)
      const bizAnchor = new Date(effNow.getTime() - 6 * 3600 * 1000)
      const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(bizAnchor)
      const todayStartIso = new Date(`${kstDate}T00:00:00+09:00`).toISOString()
      const riders = (riderRows ?? []) as Rider[]
      const deliveries = (deliveryRows ?? []) as Delivery[]
      const clients = (clientRows ?? []) as GopoumClient[]
      const allItems = (itemRows ?? []) as GopoumItem[]
      const snapshotItems = allItems.filter(i => !i.archived_at || i.archived_at >= todayStartIso)
      const pings = ((pingRows ?? []) as LocationPing[]).filter(p => p.captured_at >= todayStartIso)
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
      sheetData = { branches, todayRiders, deliveries, clients, snapshotItems, knownPings }

      if (branches.length > 0) {
        const perBranch = buildGridsByBranch(branches, todayRiders, deliveries, clients, snapshotItems, knownPings)
        try {
          const res = await Promise.allSettled(perBranch.map(b => writeSnapshot(b.code, kstDate, b.data)))
          const failed = res.map((r, i) => ({ r, code: perBranch[i].code })).filter(x => x.r.status === 'rejected')
          if (failed.length > 0) console.error(`midnight sheet_update 일부 실패: ${failed.map(f => f.code).join(', ')}`)
          performed.push('sheet_update')
        } catch (e) {
          console.error('midnight sheet_update 실패:', e)
        }
      }
    }

    // 지하위치 감지: 어제(전날 KST) arrived_at 없이 완료된 카드 → 지하/신호 끊김 후보.
    //  → 각 지점 '지하위치/전체' 스프레드시트에 업체번호 기준 upsert (감지 횟수 +1).
    //  delivery_reset 전에 실행해야 데이터가 남아있음. auto_actions 매트릭스와 무관.
    try {
      const yesterday = new Date(`${today}T00:00:00+09:00`)
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)
      const yesterdayIso = yesterday.toISOString()  // 어제 KST 00:00
      const todayIso = new Date(`${today}T00:00:00+09:00`).toISOString()
      const [{ data: rows }, { data: clientRows }, { data: branchRows }] = await Promise.all([
        supabaseServer.from('deliveries')
          .select('client_id,branch,created_at')
          .eq('status', 'completed')
          .is('arrived_at', null)
          .not('client_id', 'is', null)
          .gte('created_at', yesterdayIso)
          .lt('created_at', todayIso),
        supabaseServer.from('clients').select('id,code,name,address'),
        supabaseServer.from('branches').select('code,label'),
      ])
      const clientMap = new Map((clientRows ?? []).map((c: { id: string; code: string | null; name: string; address: string | null }) => [c.id, c]))
      const validBranchCodes = new Set((branchRows ?? []).map((b: { code: string }) => b.code))
      // 지점 code 별 · 업체번호 dedupe
      const byBranch = new Map<string, Map<string, UndergroundEntry>>()
      const yDate = yesterdayIso.slice(0, 10)  // YYYY-MM-DD
      for (const r of (rows ?? []) as { client_id: string; branch: string | null; created_at: string }[]) {
        const cli = clientMap.get(r.client_id)
        if (!cli || !cli.code) continue
        if (!r.branch || !validBranchCodes.has(r.branch)) continue
        if (!byBranch.has(r.branch)) byBranch.set(r.branch, new Map())
        const m = byBranch.get(r.branch)!
        if (!m.has(cli.code)) {
          m.set(cli.code, { code: cli.code, name: cli.name, address: cli.address ?? '', date: yDate })
        }
      }
      // 지점별 병렬 upsert
      await Promise.allSettled(
        Array.from(byBranch.entries()).map(async ([code, m]) => {
          try { await upsertUndergroundEntries(code, Array.from(m.values())) }
          catch (e) { console.error(`지하위치 시트 upsert 실패(${code}):`, e) }
        })
      )
      if (byBranch.size > 0) performed.push('underground_detect')
    } catch (e) {
      console.error('지하위치 감지 실패:', e)
    }

    // 진행중 배송 자동 완료 (midnight 트리거) — delivery_reset 전에 실행해서
    // 완료 상태로 시트에 남기고 싶다면 sheet_update.midnight 도 함께 켜야 한다.
    if (auto.finalize_pending.midnight) {
      // midnight-check 에서는 마감시각 대신 자정 직후 시각으로 기록.
      const nowMidnight = new Date().toISOString()
      const arriveRes = await supabaseServer.from('deliveries')
        .update({ arrived_at: nowMidnight })
        .eq('status', 'assigned').is('arrived_at', null).is('returned_at', null)
      if (arriveRes.error) console.error('midnight finalize_pending arrived_at 실패:', arriveRes.error)
      const finalRes = await supabaseServer.from('deliveries')
        .update({ status: 'completed', returned_at: nowMidnight })
        .eq('status', 'assigned').is('returned_at', null)
      if (finalRes.error) console.error('midnight finalize_pending completed 실패:', finalRes.error)
      performed.push('finalize_pending')
    }

    // DB 정리 (병렬)
    const tasks: PromiseLike<unknown>[] = []
    const nowIso = new Date().toISOString()
    if (auto.delivery_reset.midnight) {
      tasks.push(supabaseServer.from('deliveries').delete().not('id', 'is', null))
      // 출근시간 초기화는 배송현황 정리와 함께 (마감/자정 로그아웃 자체에선 유지).
      tasks.push(supabaseServer.from('rider_devices').update({ today_first_connected_at: null }).not('today_first_connected_at', 'is', null))
      performed.push('delivery_reset')
    }
    if (auto.gopoum_reset.midnight) {
      // 활성 품목/업체 재조회 (sheetData 재사용 안 될 때 대비)
      const { data: itemRows } = await supabaseServer.from('gopoum_items').select('*')
      const { data: clientRows } = await supabaseServer.from('gopoum_clients').select('*')
      const allItems = (itemRows ?? []) as GopoumItem[]
      const activeItems = allItems.filter(i => !i.archived_at)
      const clients = (clientRows ?? []) as GopoumClient[]
      const today = new Date(); const y = today.getUTCFullYear(); const m = today.getUTCMonth(); const d = today.getUTCDate()
      const tomorrow8am = new Date(`${new Date(Date.UTC(y, m, d + 1)).toISOString().slice(0, 10)}T08:00:00+09:00`).toISOString()
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
      // 다음날 00시 트리거 → 오늘 06:00 KST 까지 닫힘 (곧 자동 해제)
      const closedUntil = new Date(`${today}T06:00:00+09:00`).toISOString()
      tasks.push(supabaseServer.from('app_state').upsert({ key: 'closed_until', value: closedUntil }))
      tasks.push(supabaseServer.from('rider_devices').update({ connected: false, last_connected_at: null }).eq('connected', true))
      if (auto.location_share_off.midnight) performed.push('location_share_off')
      if (auto.delivery_create_block.midnight) performed.push('delivery_create_block')
    }
    if (auto.location_log_purge.midnight) {
      tasks.push(supabaseServer.from('location_pings').delete().not('id', 'is', null))
      tasks.push(supabaseServer.from('rider_locations').delete().not('device_id', 'is', null))
      performed.push('location_log_purge')
    }
    await Promise.all(tasks)

    // 마커 갱신
    await setLastMidnightResetDate(supabaseServer, today)

    void sheetData // silence unused (재사용 확장 여지)
    return NextResponse.json({ ok: true, performed, date: today })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
