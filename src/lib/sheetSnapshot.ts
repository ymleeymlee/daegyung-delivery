import { supabaseServer } from '@/lib/supabaseServer'
import { writeDeliveryTab, writeGopoumTab } from '@/lib/googleSheets'
import type { Delivery, Rider, GopoumClient, GopoumItem } from '@/types'

function kstTime(iso: string | null) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}
function kstYMD(iso: string | null) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

// 라이더 정렬: 강남(비퀵) → 안산(비퀵) → 퀵 (안산퀵 포함 가로로 이어짐)
function orderRiders(riders: Rider[]): Rider[] {
  const lp = (l?: string) => (l === 'gn' ? 0 : 1)
  return [...riders].sort((a, b) => {
    if (a.is_quick !== b.is_quick) return a.is_quick ? 1 : -1
    if (lp(a.location) !== lp(b.location)) return lp(a.location) - lp(b.location)
    return (a.created_at ?? '').localeCompare(b.created_at ?? '')
  })
}

const DCOLS = 4 // 라이더당: 상호|주소|주문시각|배정시각 (일별 탭이라 날짜열 불필요)

// 배달 현황 그리드 (전체 라이더 가로)
function buildDeliveryGrid(riders: Rider[], deliveries: Delivery[]): string[][] {
  const cols = Math.max(riders.length, 1) * DCOLS
  const grid: string[][] = []
  const set = (r: number, c: number, v: string) => {
    if (!grid[r]) grid[r] = new Array(cols).fill('')
    grid[r][c] = v
  }
  riders.forEach((rd, k) => set(0, k * DCOLS, rd.name))
  riders.forEach((_, k) => {
    const b = k * DCOLS
    set(1, b, '상호'); set(1, b + 1, '주소'); set(1, b + 2, '주문시각'); set(1, b + 3, '배정시각')
  })
  const byRider = new Map<string, Delivery[]>()
  for (const rd of riders) {
    byRider.set(rd.id, deliveries
      .filter(d => d.rider_id === rd.id)
      .sort((a, b) => (a.assigned_at ?? '').localeCompare(b.assigned_at ?? '')))
  }
  const maxRows = Math.max(0, ...riders.map(rd => byRider.get(rd.id)!.length))
  for (let i = 0; i < maxRows; i++) {
    riders.forEach((rd, k) => {
      const d = byRider.get(rd.id)![i]
      if (!d) return
      const b = k * DCOLS
      set(2 + i, b, d.client_name)
      set(2 + i, b + 1, d.client_address)
      set(2 + i, b + 2, kstTime(d.created_at))
      set(2 + i, b + 3, kstTime(d.assigned_at))
    })
  }
  for (let r = 0; r <= 1 + maxRows; r++) if (!grid[r]) grid[r] = new Array(cols).fill('')
  return grid
}

// 고품 현황 그리드 (업체 정보는 첫 행만, 품목부터 행 추가)
// 아이템 열 순서: 생성시간 | 품목 | 수거시각(또는 -) | 수거자(또는 미수거)
function buildGopoumGrid(clients: GopoumClient[], items: GopoumItem[]): string[][] {
  const grid: string[][] = [['업체번호', '업체명', '수거', '총수량', '생성날짜', '생성시간', '품목', '수거시각', '수거자']]
  for (const gc of clients) {
    const gcItems = items.filter(i => i.gopoum_client_id === gc.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    if (gcItems.length === 0) continue
    const collected = gcItems.filter(i => i.picked_at).length
    gcItems.forEach((item, i) => {
      const head = i === 0
      grid.push([
        head ? (gc.client_code || '-') : '',
        head ? gc.client_name : '',
        head ? String(collected) : '',
        head ? String(gcItems.length) : '',
        kstYMD(item.created_at),
        kstTime(item.created_at),
        item.description,
        item.picked_at ? kstTime(item.picked_at) : '-',
        item.picked_at ? (item.rider_name ?? '') : '미수거',
      ])
    })
  }
  return grid
}

// 마감 시점 현황을 그날 탭(MM-DD)에 저장. dateStr = 유효 날짜 YYYY-MM-DD
export async function saveSnapshot(dateStr: string) {
  const year = dateStr.slice(0, 4), month = dateStr.slice(5, 7), day = dateStr.slice(8, 10)

  const [{ data: riderRows }, { data: deliveryRows }, { data: clientRows }, { data: itemRows }] = await Promise.all([
    supabaseServer.from('riders').select('*').eq('is_active', true),
    // 현재 보드에 배정된 것만 (이미 마감된 completed는 제외)
    supabaseServer.from('deliveries').select('*')
      .not('rider_id', 'is', null).eq('status', 'assigned'),
    supabaseServer.from('gopoum_clients').select('*').order('created_at'),
    supabaseServer.from('gopoum_items').select('*'),
  ])

  const riders = orderRiders((riderRows ?? []) as Rider[])
  const deliveries = (deliveryRows ?? []) as Delivery[]
  const clients = (clientRows ?? []) as GopoumClient[]
  const items = ((itemRows ?? []) as GopoumItem[]).filter(i => !i.archived_at)

  // 배달·고품 시트 쓰기를 병렬로
  await Promise.all([
    writeDeliveryTab(year, month, day, buildDeliveryGrid(riders, deliveries)),
    writeGopoumTab(year, month, day, buildGopoumGrid(clients, items)),
  ])
}
