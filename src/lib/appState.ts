import { supabase } from './supabase'

export interface AppState {
  offset: number          // 테스트용 날짜 오프셋(일)
  closedUntil: string | null  // 마감 해제 시각(ISO). 이 시각 전까지 마감 상태
}

// 유효 현재 시각 = 실제 now + offset일 (테스트용 날짜 이동)
export function effNow(offset: number): Date {
  return new Date(Date.now() + offset * 86400000)
}

export function kstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
}

// 마감 상태 여부: 유효 현재가 closed_until 이전이면 마감됨
export function isClosedNow(s: AppState): boolean {
  if (!s.closedUntil) return false
  return effNow(s.offset).getTime() < new Date(s.closedUntil).getTime()
}

export async function fetchAppState(): Promise<AppState> {
  const { data } = await supabase.from('app_state').select('*')
  const m: Record<string, string> = {}
  for (const r of (data ?? []) as { key: string; value: string }[]) m[r.key] = r.value
  return {
    offset: parseInt(m.date_offset || '0') || 0,
    closedUntil: m.closed_until || null,
  }
}

export async function setDateOffset(n: number) {
  await supabase.from('app_state').upsert({ key: 'date_offset', value: String(n) })
}

// 마감 강제 해제 (테스트용 다음날 이동 시)
export async function clearClosed() {
  await supabase.from('app_state').upsert({ key: 'closed_until', value: '' })
}
