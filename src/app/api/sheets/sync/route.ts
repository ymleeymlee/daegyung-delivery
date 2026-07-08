import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'
import { writeDeliveryDay, writeGopoumDay } from '@/lib/googleSheets'
import type { Delivery, Rider, GopoumClient, GopoumItem } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function kstDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d) // YYYY-MM-DD
}
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
  }).format(new Date(iso)) // YY-MM-DD
}
function fmtDateTime(iso: string | null) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

// 라이더 정렬: 강남(비퀵) → 안산(비퀵) → 퀵. 안산퀵도 가로로 이어짐
function orderRiders(riders: Rider[]): Rider[] {
  const lp = (l?: string) => (l === 'gn' ? 0 : 1)
  return [...riders].sort((a, b) => {
    if (a.is_quick !== b.is_quick) return a.is_quick ? 1 : -1
    if (lp(a.location) !== lp(b.location)) return lp(a.location) - lp(b.location)
    return (a.created_at ?? '').localeCompare(b.created_at ?? '')
  })
}

const DCOLS = 5 // 라이더당 열: 상호|주소|주문시각|날짜|배정시각

// 하루 배달 블록 (전체 라이더 가로 배치)
function buildDeliveryBlock(dateStr: string, riders: Rider[], deliveries: Delivery[]): string[][] {
  const cols = Math.max(riders.length, 1) * DCOLS
  const grid: string[][] = []
  const set = (r: number, c: number, v: string) => {
    if (!grid[r]) grid[r] = new Array(cols).fill('')
    grid[r][c] = v
  }
  set(0, 0, `${dateStr} 배달`) // 날짜 마커
  riders.forEach((rd, k) => set(1, k * DCOLS, rd.name))
  riders.forEach((_, k) => {
    const b = k * DCOLS
    set(2, b, '상호'); set(2, b + 1, '주소'); set(2, b + 2, '주문시각'); set(2, b + 3, '날짜'); set(2, b + 4, '배정시각')
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
      set(3 + i, b, d.client_name)
      set(3 + i, b + 1, d.client_address)
      set(3 + i, b + 2, kstTime(d.created_at))
      set(3 + i, b + 3, kstYMD(d.created_at))
      set(3 + i, b + 4, kstTime(d.assigned_at))
    })
  }
  for (let r = 0; r <= 2 + maxRows; r++) if (!grid[r]) grid[r] = new Array(cols).fill('')
  return grid
}

// 하루 고품 블록 (업체 1행 + 품목 세부)
function buildGopoumBlock(dateStr: string, clients: GopoumClient[], items: GopoumItem[]): string[][] {
  const grid: string[][] = [[`${dateStr} 고품`]] // 날짜 마커
  grid.push(['생성시간', '업체번호', '업체명', '찾아온', '총수량', '품목', '수거배달자', '수거시각'])
  for (const gc of clients) {
    const gcItems = items.filter(i => i.gopoum_client_id === gc.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
    if (gcItems.length === 0) continue
    const collected = gcItems.filter(i => i.picked_at).length
    gcItems.forEach((item, i) => {
      const head = i === 0
      grid.push([
        head ? fmtDateTime(gcItems[0].created_at) : '',
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
  return grid
}

async function syncDelivery(tabDate: string) {
  // 조회는 실제 오늘 데이터, 기록 탭은 유효 날짜(tabDate)
  const realDate = kstDateStr()
  const startIso = new Date(`${realDate}T00:00:00+09:00`).toISOString()
  const endIso = new Date(new Date(`${realDate}T00:00:00+09:00`).getTime() + 86400000).toISOString()
  const [{ data: riderRows }, { data: deliveryRows }] = await Promise.all([
    supabaseServer.from('riders').select('*').eq('is_active', true),
    supabaseServer.from('deliveries').select('*')
      .not('rider_id', 'is', null).in('status', ['assigned', 'completed'])
      .gte('created_at', startIso).lt('created_at', endIso),
  ])
  const riders = orderRiders((riderRows ?? []) as Rider[])
  const deliveries = (deliveryRows ?? []) as Delivery[]
  const block = buildDeliveryBlock(tabDate, riders, deliveries)
  await writeDeliveryDay(tabDate.slice(0, 4), tabDate.slice(5, 7), tabDate, block)
}

async function syncGopoum(tabDate: string) {
  const [{ data: clientRows }, { data: itemRows }] = await Promise.all([
    supabaseServer.from('gopoum_clients').select('*').order('created_at'),
    supabaseServer.from('gopoum_items').select('*'),
  ])
  const clients = (clientRows ?? []) as GopoumClient[]
  const items = ((itemRows ?? []) as GopoumItem[]).filter(i => !i.archived_at)
  const block = buildGopoumBlock(tabDate, clients, items)
  await writeGopoumDay(tabDate.slice(0, 4), tabDate.slice(5, 7), tabDate, block)
}

// 유효 날짜/마감 상태 조회
async function getEffective() {
  const { data: st } = await supabaseServer.from('app_state').select('*')
  const m: Record<string, string> = {}
  for (const r of (st ?? []) as { key: string; value: string }[]) m[r.key] = r.value
  const offset = parseInt(m.date_offset || '0') || 0
  const effNow = new Date(Date.now() + offset * 86400000)
  const closedUntil = m.closed_until || null
  const closed = !!closedUntil && effNow.getTime() < new Date(closedUntil).getTime()
  return { dateStr: kstDateStr(effNow), closed }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const type = body.type ?? 'both'
    const { dateStr, closed } = await getEffective()
    // 마감된 날은 시트 업데이트 중지
    if (closed) return NextResponse.json({ ok: true, skipped: true, reason: 'closed' })
    if (type === 'delivery' || type === 'both') await syncDelivery(dateStr)
    if (type === 'gopoum' || type === 'both') await syncGopoum(dateStr)
    return NextResponse.json({ ok: true, date: dateStr })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const { dateStr, closed } = await getEffective()
    if (closed) return NextResponse.json({ ok: true, skipped: true, reason: 'closed' })
    await syncDelivery(dateStr)
    await syncGopoum(dateStr)
    return NextResponse.json({ ok: true, date: dateStr })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
