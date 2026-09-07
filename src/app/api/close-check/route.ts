import { NextResponse } from 'next/server'
import { runCloseIfDue } from '@/lib/closeRunner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 클라이언트 트리거용 마감 자동 실행. Nav 에서 페이지 로드 시 호출.
// 인증 없음 — closeRunner 가 idempotent(하루 1회) + 시각 판정으로 안전.
export async function GET() {
  try {
    const result = await runCloseIfDue('client')
    if (result.error) return NextResponse.json({ ok: false, ...result }, { status: 500 })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
