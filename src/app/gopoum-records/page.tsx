'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { GopoumClient, GopoumPickup } from '@/types'

function kstDateStr(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function kstHour(date: Date) {
  return parseInt(
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(date)
  )
}

// 6PM KST 이후면 오늘, 이전이면 어제가 최신 마감일
function latestClosedDate(): string {
  const now = new Date()
  if (kstHour(now) >= 18) return kstDateStr(now)
  return kstDateStr(new Date(now.getTime() - 86400000))
}

function maxAvailableDate(): string {
  return latestClosedDate()
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

// 고품 현황 카드와 동일한 레이아웃 (읽기 전용)
function GopoumHistoryCard({
  gc, pickups,
}: {
  gc: GopoumClient
  pickups: GopoumPickup[]
}) {
  const pickedTotal = pickups.reduce((sum, p) => sum + p.quantity, 0)
  const remaining = Math.max(0, gc.total_quantity - pickedTotal)
  const sorted = [...pickups].sort((a, b) => a.picked_at.localeCompare(b.picked_at))

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden flex text-sm min-h-14 ${remaining > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
      {/* 생성시간 (started_at 기준) */}
      <div className="w-16 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center text-center">
        {gc.started_at ? (
          <>
            <span className="text-xs text-slate-400">{fmtDate(gc.started_at)}</span>
            <span className="text-xs text-slate-500 font-medium">{fmtTime(gc.started_at)}</span>
          </>
        ) : (
          <span className="text-xs text-slate-300">-</span>
        )}
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
          <span className={`text-base font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {pickedTotal}
          </span>
          <span className="text-slate-300 text-xs mx-0.5">/</span>
          <span className="text-sm text-slate-700 font-medium">{gc.total_quantity}</span>
        </div>
        <span className={`text-xs ${remaining > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
          {remaining > 0 ? `잔여 ${remaining}개` : '완료'}
        </span>
      </div>

      {/* 수거 기록 */}
      <div className="flex-1 min-w-0 divide-y divide-slate-100">
        {sorted.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-300 italic flex items-center h-full">수거 기록 없음</div>
        ) : (
          sorted.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-16 text-slate-700 font-medium truncate flex-shrink-0">{p.rider_name}</span>
              <span className="w-10 text-amber-700 font-semibold text-center flex-shrink-0">{p.quantity}개</span>
              <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(p.picked_at)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

interface DayData {
  gc: GopoumClient
  pickups: GopoumPickup[]
}

export default function GopoumRecordsPage() {
  const [date, setDate] = useState(latestClosedDate)
  const [dayData, setDayData] = useState<DayData[]>([])
  const [loading, setLoading] = useState(false)

  const fetchRecords = useCallback(async (dateStr: string) => {
    setLoading(true)
    const startMs = new Date(`${dateStr}T00:00:00+09:00`).getTime()
    const startIso = new Date(startMs).toISOString()
    const endIso = new Date(startMs + 24 * 60 * 60 * 1000).toISOString()

    // 해당 날짜 6PM KST (= endIso 18:00 KST = 09:00 UTC 다음날 아님, 당일 09:00 UTC)
    const cutoffIso = new Date(`${dateStr}T18:00:00+09:00`).toISOString()

    const [{ data: pickups }, { data: clients }] = await Promise.all([
      supabase
        .from('gopoum_pickups')
        .select('*')
        .gte('picked_at', startIso)
        .lt('picked_at', cutoffIso) // 6PM 이전 수거만
        .order('picked_at'),
      supabase.from('gopoum_clients').select('*'),
    ])

    const clientMap = new Map<string, GopoumClient>()
    for (const c of (clients ?? [])) clientMap.set(c.id, c)

    // 해당 날짜에 수거가 있는 업체만
    const clientIds = [...new Set((pickups ?? []).map((p: GopoumPickup) => p.gopoum_client_id))]
    const result: DayData[] = clientIds
      .map(id => {
        const gc = clientMap.get(id)
        if (!gc) return null
        const gPickups = (pickups ?? []).filter((p: GopoumPickup) => p.gopoum_client_id === id)
        return { gc, pickups: gPickups }
      })
      .filter((d): d is DayData => d !== null)
      .sort((a, b) => a.gc.created_at.localeCompare(b.gc.created_at)) // 추가 순 (ASC)

    setDayData(result)
    setLoading(false)
  }, [])

  useEffect(() => { fetchRecords(date) }, [date, fetchRecords])

  function downloadExcel() {
    const stamp = date.replace(/-/g, '_')
    const wb = XLSX.utils.book_new()
    const colHeader = ['생성시간', '업체번호', '업체명', '찾아온수량', '총수량', '수거배달자', '수거수량', '수거시각']
    const rows: (string | number)[][] = [colHeader]

    for (const { gc, pickups } of dayData) {
      const pickedTotal = pickups.reduce((s, p) => s + p.quantity, 0)
      const sorted = [...pickups].sort((a, b) => a.picked_at.localeCompare(b.picked_at))
      const created = `${fmtDate(gc.created_at)} ${fmtTime(gc.created_at)}`

      if (sorted.length === 0) {
        rows.push([created, gc.client_code || '-', gc.client_name, pickedTotal, gc.total_quantity, '', '', ''])
      } else {
        sorted.forEach((p, i) => {
          if (i === 0) {
            rows.push([created, gc.client_code || '-', gc.client_name, pickedTotal, gc.total_quantity, p.rider_name, p.quantity, fmtDateTime(p.picked_at)])
          } else {
            rows.push(['', '', '', '', '', p.rider_name, p.quantity, fmtDateTime(p.picked_at)])
          }
        })
      }
    }

    const totalPicked = dayData.reduce((s, { pickups }) => s + pickups.reduce((ss, p) => ss + p.quantity, 0), 0)
    rows.push([])
    rows.push(['', `총 ${dayData.length}개 업체`, '', totalPicked, '', '', '', ''])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, ws, '고품내역')
    XLSX.writeFile(wb, `gopoum_${stamp}.xlsx`)
  }

  const totalPicked = dayData.reduce((s, { pickups }) => s + pickups.reduce((ss, p) => ss + p.quantity, 0), 0)
  const max = maxAvailableDate()

  return (
    <div className="p-6 max-w-full">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-800">고품 내역</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">6PM 마감 기준</span>
          <input
            type="date"
            value={date}
            max={max}
            onChange={e => setDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={downloadExcel}
            disabled={dayData.length === 0}
            className="flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white whitespace-nowrap"
          >
            엑셀 다운로드
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">불러오는 중...</div>
      ) : dayData.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-4 py-10 text-center text-slate-400 text-sm">
          해당 날짜에 수거 기록이 없습니다.
        </div>
      ) : (
        <>
          {/* 컬럼 헤더 */}
          <div className="flex text-xs text-slate-400 font-semibold mb-1.5 px-1">
            <div className="w-16 flex-shrink-0 text-center">생성시간</div>
            <div className="w-20 flex-shrink-0 pl-2">업체번호</div>
            <div className="w-40 flex-shrink-0 pl-2">업체명</div>
            <div className="w-28 flex-shrink-0 text-center">찾아온/총수량</div>
            <div className="flex-1 pl-4">수거 기록 (배달자 · 수량 · 날짜시간)</div>
          </div>

          <div className="flex flex-col gap-2 mb-4">
            {dayData.map(({ gc, pickups }) => (
              <GopoumHistoryCard key={gc.id} gc={gc} pickups={pickups} />
            ))}
          </div>

          {/* 합계 */}
          <div className="bg-amber-50 rounded-2xl border border-amber-200 px-4 py-3 text-sm font-semibold text-amber-800">
            총 {dayData.length}개 업체 · {totalPicked}개 수거
          </div>
        </>
      )}
    </div>
  )
}
