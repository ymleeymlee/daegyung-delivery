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
