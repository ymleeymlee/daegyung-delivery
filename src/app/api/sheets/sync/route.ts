import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { writeTab } from '@/lib/googleSheets'
import { LOCATIONS, buildLocationReport, reportToGrid } from '@/lib/reportLayout'
import type { Delivery, Rider, GopoumClient, GopoumItem } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function kstDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
}
function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

// 오늘 배달 현황을 지점별로 배달 탭에 기록
async function syncDelivery(dateStr: string, tabDate: string) {
  const startIso = new Date(`${dateStr}T00:00:00+09:00`).toISOString()
  const endIso = new Date(new Date(`${dateStr}T00:00:00+09:00`).getTime() + 86400000).toISOString()

  const [{ data: riderRows }, { data: deliveryRows }] = await Promise.all([
    supabaseServer.from('riders').select('*').eq('is_active', true).order('created_at'),
    supabaseServer.from('deliveries').select('*')
      .not('rider_id', 'is', null)
      .in('status', ['assigned', 'completed'])
      .gte('created_at', startIso).lt('created_at', endIso),
  ])
  const riders = (riderRows ?? []) as Rider[]
  const deliveries = (deliveryRows ?? []) as Delivery[]
  const stamp = dateStr.replace(/-/g, '_')

  // 지점별 grid를 세로로 이어붙임
  const grid: string[][] = []
  for (const location of LOCATIONS) {
    const locRiders = riders.filter(r => (r.location ?? 'gn') === location)
    if (locRiders.length === 0) continue
    const riderIds = new Set(locRiders.map(r => r.id))
    const locDeliveries = deliveries.filter(d => d.rider_id && riderIds.has(d.rider_id))
    const rep = buildLocationReport(location, stamp, locRiders, locDeliveries)
    const sub = reportToGrid(rep)
    for (const row of sub) grid.push(row)
    grid.push([]) // 지점 사이 빈 줄
  }
  await writeTab(`${tabDate} 배달`, grid)
}

// 오늘 고품 현황을 고품 탭에 기록 (업체 1행 + 품목 세부)
async function syncGopoum(dateStr: string, tabDate: string) {
  const [{ data: clientRows }, { data: itemRows }] = await Promise.all([
    supabaseServer.from('gopoum_clients').select('*').order('created_at'),
    supabaseServer.from('gopoum_items').select('*'),
  ])
  const clients = (clientRows ?? []) as GopoumClient[]
  // 마감(archived) 안 된 아이템만 — archived_at 컬럼이 없어도 안전
  const items = ((itemRows ?? []) as GopoumItem[]).filter(i => !i.archived_at)

  const grid: string[][] = [['생성시간', '업체번호', '업체명', '찾아온', '총수량', '품목', '수거배달자', '수거시각']]

  for (const gc of clients) {
    const gcItems = items.filter(i => i.gopoum_client_id === gc.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    if (gcItems.length === 0) continue
    const collected = gcItems.filter(i => i.picked_at).length
    const started = gcItems[0]?.created_at ?? gc.started_at
    const startedStr = started ? fmtDateTime(started) : ''

    gcItems.forEach((item, i) => {
      const head = i === 0
      grid.push([
        head ? startedStr : '',
        head ? (gc.client_code || '-') : '',
        head ? gc.client_name : '',
        head ? String(collected) : '',
        head ? String(gcItems.length) : '',
        item.description,
        item.rider_name ?? '',
        item.picked_at ? fmtDateTime(item.picked_at) : '미수거',
      ])
    })
  }
  await writeTab(`${tabDate} 고품`, grid)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const type = body.type ?? 'both' // 'delivery' | 'gopoum' | 'both'
    const dateStr = kstDateStr()
    const tabDate = dateStr.slice(5) // MM-DD

    if (type === 'delivery' || type === 'both') await syncDelivery(dateStr, tabDate)
    if (type === 'gopoum' || type === 'both') await syncGopoum(dateStr, tabDate)

    return NextResponse.json({ ok: true, date: dateStr })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

// GET으로도 수동 트리거 가능 (테스트용)
export async function GET() {
  try {
    const dateStr = kstDateStr()
    const tabDate = dateStr.slice(5)
    await syncDelivery(dateStr, tabDate)
    await syncGopoum(dateStr, tabDate)
    return NextResponse.json({ ok: true, date: dateStr })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
