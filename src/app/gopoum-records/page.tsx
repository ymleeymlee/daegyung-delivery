'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { GopoumClient, GopoumPickup } from '@/types'

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function kstTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

interface Row {
  clientCode: string
  clientName: string
  totalQty: number
  riderName: string
  pickedQty: number
  pickedAt: string
}

export default function GopoumRecordsPage() {
  const [date, setDate] = useState(todayKst())
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)

  const fetchRecords = useCallback(async (dateStr: string) => {
    setLoading(true)
    const startMs = new Date(`${dateStr}T00:00:00+09:00`).getTime()
    const startIso = new Date(startMs).toISOString()
    const endIso = new Date(startMs + 24 * 60 * 60 * 1000).toISOString()

    const [{ data: pickups }, { data: clients }] = await Promise.all([
      supabase
        .from('gopoum_pickups')
        .select('*')
        .gte('picked_at', startIso)
        .lt('picked_at', endIso)
        .order('picked_at'),
      supabase.from('gopoum_clients').select('*'),
    ])

    const clientMap = new Map<string, GopoumClient>()
    for (const c of (clients ?? [])) clientMap.set(c.id, c)

    const result: Row[] = (pickups ?? []).map((p: GopoumPickup) => {
      const gc = clientMap.get(p.gopoum_client_id)
      return {
        clientCode: gc?.client_code ?? '',
        clientName: gc?.client_name ?? '(알 수 없음)',
        totalQty: gc?.total_quantity ?? 0,
        riderName: p.rider_name,
        pickedQty: p.quantity,
        pickedAt: kstTime(p.picked_at),
      }
    })

    setRows(result)
    setLoading(false)
  }, [])

  useEffect(() => { fetchRecords(date) }, [date, fetchRecords])

  function downloadExcel() {
    const stamp = date.replace(/-/g, '_')
    const header = ['업체번호', '업체명', '총고품수량', '수거배달자', '수거수량', '수거시각']
    const data = rows.map(r => [r.clientCode, r.clientName, r.totalQty, r.riderName, r.pickedQty, r.pickedAt])
    const totalRow = ['', `총 ${rows.length}건`, '', '', rows.reduce((s, r) => s + r.pickedQty, 0), '']

    const ws = XLSX.utils.aoa_to_sheet([header, ...data, [], totalRow])
    ws['!cols'] = [
      { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '고품내역')
    XLSX.writeFile(wb, `gopoum_${stamp}.xlsx`)
  }

  const totalPicked = rows.reduce((s, r) => s + r.pickedQty, 0)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-800">고품 내역</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayKst()}
            onChange={e => setDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={downloadExcel}
            disabled={rows.length === 0}
            className="flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white"
          >
            엑셀 다운로드
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-4 py-10 text-center text-slate-400 text-sm">
          해당 날짜에 수거 기록이 없습니다.
        </div>
      ) : (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
            <span className="text-sm font-bold text-slate-800">
              {date.replace(/-/g, '_')} 고품 수거 내역
            </span>
            <span className="text-sm text-amber-600 font-semibold">
              총 {totalPicked}개 수거
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border border-slate-200 px-3 py-2 text-slate-600 font-semibold text-left">업체번호</th>
                  <th className="border border-slate-200 px-3 py-2 text-slate-600 font-semibold text-left">업체명</th>
                  <th className="border border-slate-200 px-3 py-2 text-slate-600 font-semibold text-center">총고품수량</th>
                  <th className="border border-slate-200 px-3 py-2 text-slate-600 font-semibold text-left">수거배달자</th>
                  <th className="border border-slate-200 px-3 py-2 text-slate-600 font-semibold text-center">수거수량</th>
                  <th className="border border-slate-200 px-3 py-2 text-slate-600 font-semibold text-center">수거시각</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="border border-slate-200 px-3 py-2 text-slate-500">{r.clientCode || '-'}</td>
                    <td className="border border-slate-200 px-3 py-2 font-medium text-slate-800">{r.clientName}</td>
                    <td className="border border-slate-200 px-3 py-2 text-center text-slate-600">{r.totalQty}</td>
                    <td className="border border-slate-200 px-3 py-2 text-slate-700">{r.riderName}</td>
                    <td className="border border-slate-200 px-3 py-2 text-center font-semibold text-amber-700">{r.pickedQty}</td>
                    <td className="border border-slate-200 px-3 py-2 text-center text-slate-500">{r.pickedAt}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-3 py-2 text-right text-slate-600 font-semibold bg-slate-50">
                    합계
                  </td>
                  <td className="border border-slate-200 px-3 py-2 text-center font-bold text-amber-700 bg-amber-50">
                    {totalPicked}
                  </td>
                  <td className="border border-slate-200 bg-slate-50" />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
