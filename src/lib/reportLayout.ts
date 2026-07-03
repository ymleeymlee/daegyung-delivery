import * as XLSX from 'xlsx'
import { Delivery, Rider } from '@/types'

export const LOCATIONS = ['gn', 'as'] as const
export type LocationCode = (typeof LOCATIONS)[number]

export const LOCATION_LABEL: Record<LocationCode, string> = {
  gn: '강남',
  as: '안산',
}

export interface ReportRow {
  clientName: string
  address: string
  orderTime: string
  assignTime: string
}

export interface RiderColumn {
  riderId: string
  name: string
  rows: ReportRow[]
  count: number
}

export interface LocationReport {
  location: LocationCode
  label: string
  dateStr: string // YYYY_MM_DD
  columns: RiderColumn[]
  grandTotal: number
}

export function kstTime(iso: string | null) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

// 라이더 + 배달을 지점 리포트 구조로 변환
export function buildLocationReport(
  location: LocationCode,
  dateStr: string,
  riders: Rider[],
  deliveries: Delivery[]
): LocationReport {
  const byRider = new Map<string, Delivery[]>()
  for (const r of riders) byRider.set(r.id, [])
  for (const d of deliveries) {
    if (d.rider_id && byRider.has(d.rider_id)) byRider.get(d.rider_id)!.push(d)
  }

  const columns: RiderColumn[] = riders.map(r => {
    const list = byRider.get(r.id)!
    list.sort((a, b) => (a.assigned_at ?? '').localeCompare(b.assigned_at ?? ''))
    return {
      riderId: r.id,
      name: r.name,
      rows: list.map(d => ({
        clientName: d.client_name,
        address: d.client_address,
        orderTime: kstTime(d.created_at),
        assignTime: kstTime(d.assigned_at),
      })),
      count: list.length,
    }
  })

  const grandTotal = columns.reduce((sum, c) => sum + c.count, 0)
  return { location, label: LOCATION_LABEL[location], dateStr, columns, grandTotal }
}

// 리포트 구조를 워크시트로 변환 (가로 = 라이더 이름, 아래 4열)
export function reportToWorksheet(rep: LocationReport): XLSX.WorkSheet {
  const riderCount = Math.max(rep.columns.length, 1)
  const cols = riderCount * 4
  const maxRows = Math.max(0, ...rep.columns.map(c => c.rows.length))

  const grid: string[][] = []
  const setCell = (row: number, col: number, val: string) => {
    if (!grid[row]) grid[row] = new Array(cols).fill('')
    grid[row][col] = val
  }
  const ensureRow = (row: number) => {
    if (!grid[row]) grid[row] = new Array(cols).fill('')
  }

  const merges: XLSX.Range[] = []

  setCell(0, 0, `${rep.dateStr} ${rep.label} 배달 내역`)
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: cols - 1 } })
  ensureRow(1)

  const NAME_ROW = 2
  const HEAD_ROW = 3
  const DATA_START = 4

  rep.columns.forEach((c, k) => {
    const base = k * 4
    setCell(NAME_ROW, base, c.name)
    merges.push({ s: { r: NAME_ROW, c: base }, e: { r: NAME_ROW, c: base + 3 } })
    setCell(HEAD_ROW, base + 0, '상호')
    setCell(HEAD_ROW, base + 1, '주소')
    setCell(HEAD_ROW, base + 2, '주문시각')
    setCell(HEAD_ROW, base + 3, '배정시각')
  })

  for (let i = 0; i < maxRows; i++) ensureRow(DATA_START + i)
  rep.columns.forEach((c, k) => {
    const base = k * 4
    c.rows.forEach((row, i) => {
      const r = DATA_START + i
      setCell(r, base + 0, row.clientName)
      setCell(r, base + 1, row.address)
      setCell(r, base + 2, row.orderTime)
      setCell(r, base + 3, row.assignTime)
    })
  })

  const TOTAL_ROW = DATA_START + maxRows + 1
  rep.columns.forEach((c, k) => {
    const base = k * 4
    setCell(TOTAL_ROW, base, `배달 ${c.count}건`)
    merges.push({ s: { r: TOTAL_ROW, c: base }, e: { r: TOTAL_ROW, c: base + 3 } })
  })

  const GRAND_ROW = TOTAL_ROW + 1
  setCell(GRAND_ROW, 0, `총 ${rep.grandTotal}군데 배달`)
  merges.push({ s: { r: GRAND_ROW, c: 0 }, e: { r: GRAND_ROW, c: cols - 1 } })

  const ws = XLSX.utils.aoa_to_sheet(grid)
  ws['!merges'] = merges
  ws['!cols'] = Array.from({ length: cols }, (_, c) => {
    const kind = c % 4
    return { wch: kind === 0 ? 16 : kind === 1 ? 24 : 10 }
  })
  return ws
}

export function reportToWorkbook(rep: LocationReport): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, reportToWorksheet(rep), rep.label)
  return wb
}

export function reportFilename(rep: LocationReport): string {
  return `dk_${rep.dateStr}_${rep.location}.xlsx`
}
