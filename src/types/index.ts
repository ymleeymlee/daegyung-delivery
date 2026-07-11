export interface Client {
  id: string
  code: string      // 업체번호
  name: string
  address: string
  created_at: string
}

export interface Rider {
  id: string
  name: string
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

export interface GopoumItem {
  id: string
  gopoum_client_id: string
  description: string
  quantity: number
  note: string | null
  rider_name: string | null
  delivery_id: string | null
  picked_at: string | null
  created_at: string
  archived_at: string | null
}
