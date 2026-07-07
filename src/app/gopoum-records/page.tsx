'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { GopoumClient, GopoumItem } from '@/types'

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}
function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

interface DayData { gc: GopoumClient; items: GopoumItem[] }

// 고품 현황과 동일한 카드 레이아웃 (읽기 전용)
function GopoumHistoryCard({ gc, items }: { gc: GopoumClient; items: GopoumItem[] }) {
  const collected = items.filter(i => i.picked_at)
  const uncollected = items.filter(i => !i.picked_at)
  const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const displayTime = sorted[0]?.created_at ?? gc.started_at ?? null

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden flex text-sm min-h-14 ${uncollected.length > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
      {/* 생성시간 */}
      <div className="w-16 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center text-center">
        {displayTime ? (
          <>
            <span className="text-xs text-slate-400">{fmtDate(displayTime)}</span>
            <span className="text-xs text-slate-500 font-medium">{fmtTime(displayTime)}</span>
          </>
        ) : <span className="text-xs text-slate-300">-</span>}
      </div>

      {/* 업체번호 */}
      <div className="w-20 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center">
        <span className="text-xs text-slate-500">{gc.client_code || '-'}</span>
      </div>

      {/* 업체명 */}
      <div className="w-40 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center">
        <span className="font-semibold text-slate-800 truncate">{gc.client_name}</span>
      </div>

      {/* 수거 현황 */}
      <div className="w-28 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center gap-0.5">
        <div className="flex items-baseline gap-0.5">
          <span className={`text-base font-bold ${uncollected.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>{collected.length}</span>
          <span className="text-slate-300 text-xs mx-0.5">/</span>
          <span className="text-sm text-slate-700 font-medium">{items.length}</span>
        </div>
        <span className={`text-xs ${uncollected.length > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
          {uncollected.length > 0 ? `잔여 ${uncollected.length}개` : '완료'}
        </span>
      </div>

      {/* 품목 목록 */}
      <div className="flex-1 min-w-0 divide-y divide-slate-100">
        {sorted.map(item => (
          <div key={item.id} className={`flex items-center gap-4 px-4 py-2 ${item.picked_at ? 'bg-green-50' : ''}`}>
            <span className={`w-40 flex-shrink-0 text-sm truncate ${item.picked_at ? 'text-green-700 line-through' : 'text-slate-700 font-medium'}`}>
              {item.description}
            </span>
            {item.picked_at ? (
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-green-600 font-bold text-sm">✓</span>
                <span className="text-sm font-bold text-slate-800">{item.rider_name}</span>
                <span className="text-sm text-slate-500">{fmtDateTime(item.picked_at)}</span>
              </span>
            ) : (
              <span className="text-sm text-amber-500 font-medium">미수거</span>
            )}
          </div>
        ))}
        {items.length === 0 && <div className="px-4 py-3 text-xs text-slate-300 italic">품목 없음</div>}
      </div>
    </div>
  )
}

export default function GopoumRecordsPage() {
  const [date, setDate] = useState(todayKst)
  const [dayData, setDayData] = useState<DayData[]>([])
  const [loading, setLoading] = useState(false)

  const fetchRecords = useCallback(async (dateStr: string) => {
    setLoading(true)
    const startMs = new Date(`${dateStr}T00:00:00+09:00`).getTime()
    const startIso = new Date(startMs).toISOString()
    const endIso = new Date(startMs + 24 * 60 * 60 * 1000).toISOString()

    // 마감된(archived) 아이템을 마감일 기준으로 조회
    const [{ data: items }, { data: clients }] = await Promise.all([
      supabase.from('gopoum_items').select('*').gte('archived_at', startIso).lt('archived_at', endIso),
      supabase.from('gopoum_clients').select('*'),
    ])

    const clientMap = new Map<string, GopoumClient>()
    for (const c of (clients ?? [])) clientMap.set(c.id, c)

    // 해당일 수거 기록이 있는 업체 기준으로 그룹핑
    const clientIds = [...new Set((items ?? []).map((i: GopoumItem) => i.gopoum_client_id))]
    const result: DayData[] = clientIds
      .map(id => {
        const gc = clientMap.get(id)
        if (!gc) return null
        return { gc, items: (items ?? []).filter((i: GopoumItem) => i.gopoum_client_id === id) }
      })
      .filter((d): d is DayData => d !== null)
      .sort((a, b) => a.gc.created_at.localeCompare(b.gc.created_at))

    setDayData(result)
    setLoading(false)
  }, [])

  useEffect(() => { fetchRecords(date) }, [date, fetchRecords])

  function downloadExcel() {
    const stamp = date.replace(/-/g, '_')
    const header = ['생성시간', '업체번호', '업체명', '찾아온수량', '총수량', '품목', '수거배달자', '수거시각']
    const rows: (string | number)[][] = [header]

    for (const { gc, items } of dayData) {
      const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))
      const started = gc.started_at ? `${fmtDate(gc.started_at)} ${fmtTime(gc.started_at)}` : '-'
      const collected = items.filter(i => i.picked_at).length

      sorted.forEach((item, i) => {
        if (i === 0) {
          rows.push([started, gc.client_code || '-', gc.client_name, collected, items.length,
            item.description, item.rider_name ?? '', item.picked_at ? fmtDateTime(item.picked_at) : '미수거'])
        } else {
          rows.push(['', '', '', '', '', item.description, item.rider_name ?? '', item.picked_at ? fmtDateTime(item.picked_at) : '미수거'])
        }
      })
      if (items.length === 0) rows.push([started, gc.client_code || '-', gc.client_name, 0, 0, '', '', ''])
    }

    const totalCollected = dayData.reduce((s, { items }) => s + items.filter(i => i.picked_at).length, 0)
    rows.push([])
    rows.push(['', `총 ${dayData.length}개 업체`, '', totalCollected, '', '', '', ''])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '고품내역')
    XLSX.writeFile(wb, `gopoum_${stamp}.xlsx`)
  }

  const totalCollected = dayData.reduce((s, { items }) => s + items.filter(i => i.picked_at).length, 0)
  const max = todayKst()

  return (
    <div className="p-6 max-w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-800">고품 내역</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">6PM 마감 기준</span>
          <input type="date" value={date} max={max} onChange={e => setDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <button onClick={downloadExcel} disabled={dayData.length === 0}
            className="flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 bg-green-600 hover:bg-green-700 text-white whitespace-nowrap">
            엑셀 다운로드
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">불러오는 중...</div>
      ) : dayData.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-4 py-10 text-center text-slate-400 text-sm">해당 날짜에 수거 기록이 없습니다.</div>
      ) : (
        <>
          <div className="flex text-xs text-slate-400 font-semibold mb-1.5 px-1">
            <div className="w-16 flex-shrink-0 text-center">생성시간</div>
            <div className="w-20 flex-shrink-0 pl-2">업체번호</div>
            <div className="w-40 flex-shrink-0 pl-2">업체명</div>
            <div className="w-28 flex-shrink-0 text-center">찾아온/총수량</div>
            <div className="flex-1 pl-4">품목 목록 (품목 · 수거배달자 · 시각)</div>
          </div>
          <div className="flex flex-col gap-2 mb-4">
            {dayData.map(({ gc, items }) => <GopoumHistoryCard key={gc.id} gc={gc} items={items} />)}
          </div>
          <div className="bg-amber-50 rounded-2xl border border-amber-200 px-4 py-3 text-sm font-semibold text-amber-800">
            총 {dayData.length}개 업체 · {totalCollected}개 수거 완료
          </div>
        </>
      )}
    </div>
  )
}
