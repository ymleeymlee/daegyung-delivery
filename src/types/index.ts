// 지점 (branches 테이블). 하드코딩 enum 대신 DB에서 동적으로 로드.
export interface Branch {
  code: string
  label: string
  sort_order: number
  created_at: string
  open_time: string | null
  close_time: string | null
}

export interface Client {
  id: string
  code: string      // 업체번호
  name: string
  address: string
  created_at: string
  lat?: number | null   // 주소 지오코딩 좌표 (등록 시 웹에서 카카오로 1회 변환)
  lng?: number | null
  region?: string | null // 좌표 기반 행정동 (예: '부곡동'). 업체 그룹 구분 용도
  branch: string     // 지점 코드 (branches.code)
}

export interface Rider {
  id: string
  name: string
  phone: string | null   // 연락처
  is_active: boolean
  is_quick: boolean   // true: 안산퀵·파워퀵 전용 구역
  location: string   // 지점 코드 (branches.code)
  created_at: string
}

export type DeliveryStatus = 'waiting' | 'assigned' | 'completed' | 'cancelled'

export interface Delivery {
  id: string
  client_id: string | null
  client_name: string
  client_address: string
  status: DeliveryStatus
  created_at: string
  assigned_at: string | null
  rider_id: string | null
  sort_order: number
  branch: string     // 지점 코드 (branches.code)
  // 배송지 좌표 (업체 좌표 복사 · 앱 자동 도착감지용)
  dest_lat?: number | null
  dest_lng?: number | null
  // 배송출발(본사 이탈) 시각. 앱이 지오펜스 이탈 시 기록.
  departed_at?: string | null
  // 배송완료 = 배송지 도착 시각. 라이더가 배송지 반경에 진입한 시각. 이탈 시 status=completed.
  arrived_at?: string | null
  // 본사복귀(본사 도착) 시각. 앱이 지오펜스 진입 시 기록.
  returned_at?: string | null
  // 위치추적 ETA/지연용 (지금은 미사용 · optional)
  eta_seconds?: number | null
  baseline_arrival_at?: string | null
  // 배송 비고 (웹에서만 편집. 마감 시 시트의 '비고' 열로 반영)
  note?: string | null
  // 서버 트리거로 자동 유지되는 '남은 고품 수량' 스냅샷 — 뱃지 표시용
  gopoum_count?: number | null
  // 총 고품 수량(수거 무관) — 수거 완료 후에도 뱃지 유지용
  gopoum_total?: number | null
  gopoum_cars?: string | null
  // 같은 region(법정동)의 다른 거래처들의 '남은 고품 수량' 합계
  nearby_gopoum_count?: number | null
  nearby_gopoum_total?: number | null
}

/** 주변 고품 품목 — RPC nearby_gopoum_items_for_delivery 가 반환. */
export interface NearbyGopoumItem {
  id: string
  description: string
  car_type: string | null
  note: string | null
  quantity: number
  collectors: GopoumCollector[]
  created_at: string
  gopoum_client_id: string
  client_code: string
  client_name: string
}

// 기기 ↔ 라이더 매핑 (앱은 device_id 로만 write, 웹에서 라이더 지정)
export interface RiderDevice {
  device_id: string
  rider_id: string | null
  label: string | null
  last_seen_at: string | null
  created_at: string
  name: string | null
  phone: string | null
  branch: string | null
  connected: boolean
  last_connected_at: string | null
  today_first_connected_at: string | null
  app_version: string | null
}

// 기기별 최신 위치 (실시간 지도용). rider_* 는 앱이 안 채우므로 웹에서 매핑으로 해석.
export interface RiderLocation {
  device_id: string
  rider_id: string | null
  rider_name: string | null
  lat: number
  lng: number
  accuracy: number | null
  updated_at: string
}

// 원시 GPS 핑 (기록·동선용)
export interface LocationPing {
  id: string
  device_id: string | null
  rider_id: string | null
  rider_name: string | null
  lat: number
  lng: number
  accuracy: number | null
  captured_at: string
  created_at: string
}

// 배송 회차: 앱이 본사 이탈 시 insert, 복귀 시 ended_at 갱신 (device_id 기준)
export interface DeliveryTrip {
  id: string
  device_id: string | null
  rider_id: string | null
  rider_name: string | null
  started_at: string
  ended_at: string | null
  created_at: string
}

export interface GopoumClient {
  id: string
  client_id: string | null
  client_code: string
  client_name: string
  total_quantity: number
  created_at: string
  started_at: string | null
  branch: string     // 지점 코드 (branches.code)
}

export interface GopoumPickup {
  id: string
  gopoum_client_id: string
  delivery_id: string | null
  rider_name: string
  quantity: number
  picked_at: string
}

// 한 배송(라이더)이 이 품목에서 수거한 기록
export interface GopoumCollector {
  delivery_id: string | null
  rider_name: string
  quantity: number
  picked_at: string
}

export interface GopoumItem {
  id: string
  gopoum_client_id: string
  description: string
  car_type: string | null       // 차종 (선택 입력, null 이면 UI 에서 '차종모름')
  quantity: number              // 총 수거해야 할 수량 (고품현황에서 입력)
  note: string | null
  collectors: GopoumCollector[] // 배송자별 수거량 기록 (부분·다중 수거)
  rider_name: string | null     // 수거자명(합쳐진 문자열, 시트/호환용)
  delivery_id: string | null    // (레거시) 다중 수거로 의미 축소
  picked_at: string | null      // 총량이 모두 수거된 시각 (완전수거). 부분이면 null
  created_at: string
  archived_at: string | null
}
