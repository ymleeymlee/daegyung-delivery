import { supabase } from './supabase'

export interface AppState {
  offset: number          // 테스트용 날짜 오프셋(일)
  closedUntil: string | null  // 레거시: /api/close 크론 등 기존 로직 호환용
  minAppVersion: string | null  // 앱 최소 요구 버전. 미달 앱은 웹에서 무시.
}

// 유효 현재 시각 = 실제 now + offset일 (테스트용 날짜 이동)
export function effNow(offset: number): Date {
  return new Date(Date.now() + offset * 86400000)
}

export function kstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
}

// 현재 KST HH:MM 반환. offsetDays: 테스트용 날짜 이동
export function kstNowHm(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
}

// 지점 운영시간 기준 마감 여부 실시간 판정
// open/close 모두 null → 제한 없음(false)
export function isBranchClosed(nowHm: string, open?: string | null, close?: string | null): boolean {
  if (!open && !close) return false
  if (open && nowHm < open) return true
  if (close && nowHm >= close) return true
  return false
}

// 기존 시그니처 유지 (레거시 호출부 호환)
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
    minAppVersion: m.min_app_version || null,
  }
}

export async function setDateOffset(n: number) {
  await supabase.from('app_state').upsert({ key: 'date_offset', value: String(n) })
}

// 마감 강제 해제 (테스트용 다음날 이동 시)
export async function clearClosed() {
  await supabase.from('app_state').upsert({ key: 'closed_until', value: '' })
}
