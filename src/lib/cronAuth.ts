import type { NextRequest } from 'next/server'

// 크론 전용 엔드포인트 인증. CRON_SECRET 이 설정돼 있을 때만 통과한다(fail-closed).
// Vercel 은 CRON_SECRET 이 있으면 크론 요청에 Authorization: Bearer <secret> 을 자동 주입한다.
//
// 예전엔 시크릿 미설정 시 통과시키는 폴백이 있었다(close 는 x-vercel-cron 헤더 존재만 확인,
// daily-reset/daily-report 는 무조건 true). 그 헤더는 외부에서 위조 가능하고 무조건 통과는
// 아예 무방비라, 마감·리셋 같은 파괴적 작업이 열려 있었다. 폴백 제거(2026-07-30).
//
// 시크릿이 없으면 크론이 실패한다 — 조용히 뚫려 있는 것보다 눈에 띄게 실패하는 편이 안전하다.
export function fromCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET 미설정 — 크론 요청 거부됨. Vercel 환경변수 설정 필요.')
    return false
  }
  return req.headers.get('authorization') === `Bearer ${secret}`
}
