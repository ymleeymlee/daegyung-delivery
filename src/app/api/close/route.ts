import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// 하루 마감: 배달 현황 초기화 + 고품 수거분 아카이브
// - 배달: 대기/배정 → completed (배달 내역에는 created_at 기준으로 남음)
// - 고품: 수거된 미아카이브 아이템 → archived_at 설정 (고품 내역에 남고 현황에서 사라짐)
//   미수거 아이템은 이월, gopoum_clients.total_quantity를 잔여 수량으로 갱신
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)

  // 다음날 오전 8시 KST (이월된 잔여 고품의 생성시간)
  const [y, m, d] = kstDate.split('-').map(Number)
  const tomorrowStr = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const tomorrow8am = new Date(`${tomorrowStr}T08:00:00+09:00`).toISOString()

  try {
    // 1) 취소 카드 완전 삭제
    await supabaseServer.from('deliveries').delete().eq('status', 'cancelled')

    // 2) 배달 보드 초기화: 대기/배정 → completed
    const { data: archivedDeliveries } = await supabaseServer
      .from('deliveries')
      .update({ status: 'completed' })
      .in('status', ['waiting', 'assigned'])
      .select('id')

    // 3) 고품 수거분 아카이브
    const { data: archivedItems } = await supabaseServer
      .from('gopoum_items')
      .update({ archived_at: nowIso })
      .not('picked_at', 'is', null)
      .is('archived_at', null)
      .select('id')

    // 4) gopoum_clients 잔여 수량 갱신
    const [{ data: clients }, { data: items }] = await Promise.all([
      supabaseServer.from('gopoum_clients').select('id'),
      supabaseServer.from('gopoum_items').select('id, gopoum_client_id, picked_at, archived_at'),
    ])
    for (const gc of clients ?? []) {
      const remaining = (items ?? []).filter(
        (i: { gopoum_client_id: string; picked_at: string | null; archived_at: string | null }) =>
          i.gopoum_client_id === gc.id && !i.picked_at && !i.archived_at
      ).length
      await supabaseServer.from('gopoum_clients').update({
        total_quantity: remaining,
        started_at: remaining > 0 ? tomorrow8am : null,
      }).eq('id', gc.id)
    }

    // 5) 90일 지난 배달 기록 영구 삭제
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    await supabaseServer.from('deliveries').delete().eq('status', 'completed').lt('created_at', cutoff)

    return NextResponse.json({
      ok: true,
      deliveries: archivedDeliveries?.length ?? 0,
      gopoumItems: archivedItems?.length ?? 0,
      date: kstDate,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
