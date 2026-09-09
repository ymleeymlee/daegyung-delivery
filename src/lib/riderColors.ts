// 출근한 라이더 순(today_first_connected_at 오름차순)으로 배정할 색상 팔레트.
// 무지개 7색 + 시각적으로 겹치지 않는 추가 8색 = 15색.
// 배송현황 라이더 이름 옆 뱃지 · 실시간 위치 마커/동선 색상에 공용으로 사용.
export const RIDER_PALETTE: string[] = [
  '#ef4444', // 빨
  '#f97316', // 주
  '#eab308', // 노
  '#22c55e', // 초
  '#0ea5e9', // 파
  '#3b82f6', // 남
  '#a855f7', // 보
  '#ec4899', // 핑크
  '#14b8a6', // 청록
  '#84cc16', // lime
  '#6366f1', // indigo
  '#d946ef', // fuchsia
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f43f5e', // rose
]

// 출근한 기기들을 today_first_connected_at 오름차순으로 정렬 후 색상 배정.
// null(아직 출근 안 함)은 색상 없음. 팔레트 초과 시 순환.
export function buildRiderColorMap(
  devices: { device_id: string; today_first_connected_at: string | null }[]
): Map<string, string> {
  const sorted = [...devices]
    .filter(d => d.today_first_connected_at)
    .sort((a, b) => a.today_first_connected_at!.localeCompare(b.today_first_connected_at!))
  const m = new Map<string, string>()
  sorted.forEach((d, i) => m.set(d.device_id, RIDER_PALETTE[i % RIDER_PALETTE.length]))
  return m
}
