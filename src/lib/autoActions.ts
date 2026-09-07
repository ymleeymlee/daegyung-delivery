// 자동 수행 설정 — 마감(22:00 KST) 또는 다음날 00시에 실행할 항목을 관리.
// app_state.auto_actions (JSON) 하나에 담긴다.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AutoActionKey =
  | 'sheet_update'            // 시트 업데이트 (배송·고품·위치 시트 저장)
  | 'location_share_off'      // 위치 공유 차단 (closed_until 설정)
  | 'delivery_create_block'   // 배송 카드 생성 차단 (closed_until 설정 — 위와 동일 매커니즘)
  | 'delivery_reset'          // 배송 현황 정리 (진행중 포함 전체 삭제)
  | 'gopoum_reset'            // 고품 현황 정리 (수거된 항목 archive + 잔여수량 갱신)
  | 'location_log_purge'      // 위치 로그 정리 (location_pings + rider_locations)

export interface AutoActionConfig {
  close: boolean
  midnight: boolean
}

export type AutoActionsMap = Record<AutoActionKey, AutoActionConfig>

export const AUTO_ACTION_ITEMS: { key: AutoActionKey; label: string; hint?: string }[] = [
  { key: 'sheet_update', label: '시트 업데이트', hint: '현재 내용을 배송·고품·위치 시트에 저장' },
  { key: 'location_share_off', label: '위치 공유 차단', hint: '앱 위치 공유 종료 (다음날 06시 자동 해제)' },
  { key: 'delivery_create_block', label: '배송 카드 생성 차단', hint: '웹에서 새 배송 카드 만들기 차단' },
  { key: 'delivery_reset', label: '배송 현황 정리', hint: '진행중·완료 모두 배송 카드 전체 삭제' },
  { key: 'gopoum_reset', label: '고품 현황 정리', hint: '수거 완료된 품목 아카이브, 업체별 잔여수량 갱신' },
  { key: 'location_log_purge', label: '위치 로그 정리', hint: 'location_pings, rider_locations 데이터 삭제' },
]

// 기본값: 모든 항목이 마감 시 자동 실행. 다음날은 모두 꺼짐.
export function defaultAutoActions(): AutoActionsMap {
  const out = {} as AutoActionsMap
  for (const it of AUTO_ACTION_ITEMS) out[it.key] = { close: true, midnight: false }
  return out
}

const KEY = 'auto_actions'
const LAST_MIDNIGHT_KEY = 'last_midnight_reset_date'

// 저장값에 새 항목 추가돼도 default 값으로 병합해 반환한다.
export async function fetchAutoActions(client: SupabaseClient): Promise<AutoActionsMap> {
  const { data } = await client.from('app_state').select('value').eq('key', KEY).maybeSingle()
  const raw = (data as { value?: string } | null)?.value
  const base = defaultAutoActions()
  if (!raw) return base
  try {
    const parsed = JSON.parse(raw) as Partial<AutoActionsMap>
    for (const it of AUTO_ACTION_ITEMS) {
      const v = parsed[it.key]
      if (v && typeof v === 'object') base[it.key] = { close: !!v.close, midnight: !!v.midnight }
    }
  } catch { /* fall through with defaults */ }
  return base
}

export async function saveAutoActions(client: SupabaseClient, map: AutoActionsMap): Promise<void> {
  const { error } = await client.from('app_state').upsert({ key: KEY, value: JSON.stringify(map) })
  if (error) throw error
}

// 다음날(00시) idempotency 마커
export async function getLastMidnightResetDate(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.from('app_state').select('value').eq('key', LAST_MIDNIGHT_KEY).maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

export async function setLastMidnightResetDate(client: SupabaseClient, date: string): Promise<void> {
  const { error } = await client.from('app_state').upsert({ key: LAST_MIDNIGHT_KEY, value: date })
  if (error) throw error
}

// KST 오늘 날짜 (YYYY-MM-DD)
export function kstToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
