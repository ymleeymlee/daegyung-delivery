import { NextRequest, NextResponse } from 'next/server'
import { fromCron } from '@/lib/cronAuth'
import { runCloseIfDue } from '@/lib/closeRunner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 마감 크론 (매일 22:00 KST = 13:00 UTC). 안전망 역할.
// 실제 실행은 lib/closeRunner 가 business_close_time · last_close_reset_date 로 판정.
// 사용자가 close_time 을 22:00 보다 이르게 잡으면 클라이언트 트리거(/api/close-check)가 먼저 실행하고,
// 이 크론은 이미 실행됨을 확인하고 skip 한다. 클라이언트가 안 열리면 22:00 크론이 폴백으로 실행.
export async function GET(req: NextRequest) {
  if (!fromCron(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden (cron only)' }, { status: 403 })
  }
  try {
    const result = await runCloseIfDue('cron')
    if (result.error) return NextResponse.json({ ok: false, ...result }, { status: 500 })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
