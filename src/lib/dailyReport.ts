import * as XLSX from 'xlsx'
import { supabaseServer } from './supabaseServer'
import { Delivery, Rider } from '@/types'
import {
  LOCATIONS,
  LocationCode,
  buildLocationReport,
  reportToWorkbook,
  reportFilename,
} from './reportLayout'

// KST(Asia/Seoul) 기준 오늘 날짜 파트
function kstDateParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now)
  return { y, m, d }
}

// KST 기준 오늘 0시의 UTC ISO 문자열
export function kstStartOfTodayIso(now = new Date()) {
  const { y, m, d } = kstDateParts(now)
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`).toISOString()
}

// 파일명용 날짜: YYYY_MM_DD
export function dateStampUnderscore(now = new Date()) {
  const { y, m, d } = kstDateParts(now)
  return `${y}_${m}_${d}`
}

export interface ReportFile {
  location: LocationCode
  filename: string
  buffer: Buffer
  total: number
}

// 당일 지점별 리포트 파일 생성
export async function generateDailyReports(now = new Date()): Promise<ReportFile[]> {
  const startIso = kstStartOfTodayIso(now)
  const stamp = dateStampUnderscore(now)

  const [{ data: riderRows }, { data: deliveryRows }] = await Promise.all([
    supabaseServer.from('riders').select('*').eq('is_active', true).order('created_at'),
    supabaseServer
      .from('deliveries')
      .select('*')
      .not('rider_id', 'is', null)
      .in('status', ['assigned', 'completed'])
      .gte('created_at', startIso),
  ])

  const riders = (riderRows ?? []) as Rider[]
  const deliveries = (deliveryRows ?? []) as Delivery[]

  const files: ReportFile[] = []
  for (const location of LOCATIONS) {
    const locRiders = riders.filter(r => (r.location ?? 'gn') === location)
    const riderIds = new Set(locRiders.map(r => r.id))
    const locDeliveries = deliveries.filter(d => d.rider_id && riderIds.has(d.rider_id))
    if (locDeliveries.length === 0) continue // 배달 없는 지점은 생략

    const rep = buildLocationReport(location, stamp, locRiders, locDeliveries)
    const wb = reportToWorkbook(rep)
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    files.push({
      location,
      filename: reportFilename(rep),
      buffer,
      total: rep.grandTotal,
    })
  }
  return files
}
