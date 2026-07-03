import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    // 0) 취소된 카드는 기록에서 제외 → 완전 삭제
    await supabaseServer.from('deliveries').delete().eq('status', 'cancelled')

    // 1) 보드 초기화: 진행 중인 배달(대기/배정)을 completed로 아카이브 → 화면에서 사라짐
    const { data: archived, error: archiveError } = await supabaseServer
      .from('deliveries')
      .update({ status: 'completed' })
      .in('status', ['waiting', 'assigned'])
      .select('id')
    if (archiveError) throw archiveError

    // 2) 90일 지난 기록 영구 삭제 (용량 관리)
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data: purged, error: purgeError } = await supabaseServer
      .from('deliveries')
      .delete()
      .eq('status', 'completed')
      .lt('created_at', cutoff)
      .select('id')
    if (purgeError) throw purgeError

    return NextResponse.json({
      ok: true,
      archived: archived?.length ?? 0,
      purged: purged?.length ?? 0,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
