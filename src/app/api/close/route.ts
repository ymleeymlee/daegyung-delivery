import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { saveSnapshot } from '@/lib/sheetSnapshot'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 마감: 유효 현재일 기준
// - 배달: 대기/배정 → completed (보드 비움)
// - 고품: 수거된 품목 archived(현황에서 제거), 미수거는 유지
// - closed_until = 다음날 06:00 KST 저장 → 그 전까지 마감 상태
export async function GET(_req: NextRequest) {
  // app_state 읽기 (offset)
  const { data: st } = await supabaseServer.from('app_state').select('*')
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

  try {
    // 1) 마감 직전 현황을 그날 탭(MM-DD)에 스냅샷 저장 (정리 전에)
    await saveSnapshot(kstDate)

    await supabaseServer.from('deliveries').delete().eq('status', 'cancelled')
    await supabaseServer.from('deliveries').update({ status: 'completed' }).in('status', ['waiting', 'assigned'])

    // 수거된(미아카이브) 고품 → archived (현황에서 제거). 미수거는 그대로 유지.
    await supabaseServer.from('gopoum_items').update({ archived_at: nowIso })
      .not('picked_at', 'is', null).is('archived_at', null)

    // 업체별 잔여(미수거) 수량으로 갱신
    const [{ data: clients }, { data: items }] = await Promise.all([
      supabaseServer.from('gopoum_clients').select('id'),
      supabaseServer.from('gopoum_items').select('id, gopoum_client_id, picked_at, archived_at'),
    ])
    for (const gc of clients ?? []) {
      const rem = (items ?? []).filter(
        (i: { gopoum_client_id: string; picked_at: string | null; archived_at: string | null }) =>
          i.gopoum_client_id === gc.id && !i.picked_at && !i.archived_at
      ).length
      await supabaseServer.from('gopoum_clients')
        .update({ total_quantity: rem, started_at: rem > 0 ? tomorrow8am : null })
        .eq('id', gc.id)
    }

    // 90일 지난 배달 영구 삭제
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    await supabaseServer.from('deliveries').delete().eq('status', 'completed').lt('created_at', cutoff)

    // 마감 상태 저장
    await supabaseServer.from('app_state').upsert({ key: 'closed_until', value: closedUntil })

    return NextResponse.json({ ok: true, date: kstDate, closedUntil })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
