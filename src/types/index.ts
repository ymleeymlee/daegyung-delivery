export interface Client {
  id: string
  code: string      // 업체번호
  name: string
  address: string
  created_at: string
  lat?: number | null   // 주소 지오코딩 좌표 (등록 시 웹에서 카카오로 1회 변환)
  lng?: number | null
}

export interface Rider {
  id: string
  name: string
  phone: string | null   // 연락처
  is_active: boolean
  is_quick: boolean   // true: 안산퀵·파워퀵 전용 구역
  location: 'gn' | 'as'   // 지점: gn=강남, as=안산
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
}

// 기기 ↔ 라이더 매핑 (앱은 device_id 로만 write, 웹에서 라이더 지정)
export interface RiderDevice {
  device_id: string
  rider_id: string | null
  label: string | null
  last_seen_at: string | null
  created_at: string
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
  quantity: number              // 총 수거해야 할 수량 (고품현황에서 입력)
  note: string | null
  collectors: GopoumCollector[] // 배송자별 수거량 기록 (부분·다중 수거)
  rider_name: string | null     // 수거자명(합쳐진 문자열, 시트/호환용)
  delivery_id: string | null    // (레거시) 다중 수거로 의미 축소
  picked_at: string | null      // 총량이 모두 수거된 시각 (완전수거). 부분이면 null
  created_at: string
  archived_at: string | null
}
