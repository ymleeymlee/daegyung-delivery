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

// 배송 현황 그리드 (전체 라이더 가로)
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
// collectors(배송자별 수거량) 기반: 부분수거·다중수거·잔여 수량까지 기록.
// 수거자가 여러 명이면 수거자별로 행을 나눠 기록(수거날짜·수거시각·수거자·수거량).
// 열: 업체번호 | 업체명 | 수거 | 총수량 | 생성날짜 | 생성시간 | 품목 | 수거날짜 | 수거시각 | 수거자 | 수거량/총 | 비고
function buildGopoumGrid(clients: GopoumClient[], items: GopoumItem[]): string[][] {
  const qtyOf = (i: GopoumItem) => i.quantity ?? 1
  const collectedOf = (i: GopoumItem) => (i.collectors ?? []).reduce((s, c) => s + c.quantity, 0)
  const grid: string[][] = [['업체번호', '업체명', '수거', '총수량', '생성날짜', '생성시간', '품목', '수거날짜', '수거시각', '수거자', '수거량/총', '비고']]
  for (const gc of clients) {
    const gcItems = items.filter(i => i.gopoum_client_id === gc.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    if (gcItems.length === 0) continue
    const totalQty = gcItems.reduce((s, i) => s + qtyOf(i), 0)          // 총 수량 합
    const collectedQty = gcItems.reduce((s, i) => s + collectedOf(i), 0) // 수거된 수량 합

    const clientRows: string[][] = []
    for (const item of gcItems) {
      const cols = item.collectors ?? []
      const ratio = `${collectedOf(item)}/${qtyOf(item)}`
      if (cols.length === 0) {
        // 미수거: 한 행
        clientRows.push(['', '', '', '', kstYMD(item.created_at), kstTime(item.created_at), item.description, '-', '-', '미수거', ratio, item.note ?? ''])
      } else {
        // 수거자별로 한 행씩. 품목 정보(생성날짜/시간/품목/수거량·총/비고)는 첫 행만
        cols.forEach((c, ci) => {
          const head = ci === 0
          const label = `${c.rider_name}${c.quantity > 1 ? `(${c.quantity})` : ''}`
          clientRows.push([
            '', '', '', '',
            head ? kstYMD(item.created_at) : '',
            head ? kstTime(item.created_at) : '',
            head ? item.description : '',
            kstYMD(c.picked_at),
            kstTime(c.picked_at),
            label,
            head ? ratio : '',
            head ? (item.note ?? '') : '',
          ])
        })
      }
    }
    // 업체 정보(업체번호/업체명/수거/총수량)는 업체 첫 행만
    clientRows[0][0] = gc.client_code || '-'
    clientRows[0][1] = gc.client_name
    clientRows[0][2] = String(collectedQty)
    clientRows[0][3] = String(totalQty)
    grid.push(...clientRows)
  }
  return grid
}

export interface SnapshotData {
  deliveryGrid: string[][]
  gopoumGrid: string[][]
}

// 조회한 데이터로 시트 그리드 생성 (동기). close에서 조회를 공유해 왕복 최소화
export function buildGrids(riders: Rider[], deliveries: Delivery[], clients: GopoumClient[], activeItems: GopoumItem[]): SnapshotData {
  return {
    deliveryGrid: buildDeliveryGrid(orderRiders(riders), deliveries),
    gopoumGrid: buildGopoumGrid(clients, activeItems),
  }
}

// 그리드를 그날 탭(MM-DD)에 저장 (느림 — Google Sheets API). 백그라운드 실행용
export async function writeSnapshot(dateStr: string, data: SnapshotData) {
  const year = dateStr.slice(0, 4), month = dateStr.slice(5, 7), day = dateStr.slice(8, 10)
  await Promise.all([
    writeDeliveryTab(year, month, day, data.deliveryGrid),
    writeGopoumTab(year, month, day, data.gopoumGrid),
  ])
}
