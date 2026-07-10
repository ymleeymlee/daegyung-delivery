'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Delivery, Rider } from '@/types'
import {
  LOCATIONS,
  LocationReport,
  buildLocationReport,
  reportToWorkbook,
  reportFilename,
} from '@/lib/reportLayout'

// KST 기준 오늘 날짜 YYYY-MM-DD
function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default function RecordsPage() {
  const [date, setDate] = useState(todayKst())
  const [reports, setReports] = useState<LocationReport[]>([])
  const [loading, setLoading] = useState(false)

  const fetchReports = useCallback(async (dateStr: string) => {
    setLoading(true)
    const startMs = new Date(`${dateStr}T00:00:00+09:00`).getTime()
    const startIso = new Date(startMs).toISOString()
    const endIso = new Date(startMs + 24 * 60 * 60 * 1000).toISOString()

    const [{ data: riderRows }, { data: deliveryRows }] = await Promise.all([
      supabase.from('riders').select('*').eq('is_active', true).order('created_at'),
      supabase
        .from('deliveries')
        .select('*')
        .not('rider_id', 'is', null)
        .in('status', ['assigned', 'completed'])
        .gte('created_at', startIso)
        .lt('created_at', endIso),
    ])

    const riders = (riderRows ?? []) as Rider[]
    const deliveries = (deliveryRows ?? []) as Delivery[]
    const stamp = dateStr.replace(/-/g, '_')

    const result: LocationReport[] = LOCATIONS.map(location => {
      const locRiders = riders.filter(r => (r.location ?? 'gn') === location)
      const riderIds = new Set(locRiders.map(r => r.id))
      const locDeliveries = deliveries.filter(d => d.rider_id && riderIds.has(d.rider_id))
      return buildLocationReport(location, stamp, locRiders, locDeliveries)
    })
    setReports(result)
    setLoading(false)
  }, [])

  useEffect(() => { fetchReports(date) }, [date, fetchReports])

  function download(rep: LocationReport) {
    const wb = reportToWorkbook(rep)
    XLSX.writeFile(wb, reportFilename(rep))
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-800">배송 내역</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={todayKst()}
            onChange={e => setDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>

      <p className="text-xs text-slate-400 mb-4">기록은 90일간 보관됩니다.</p>

      {loading ? (
        <div className="text-center text-slate-400 py-16 text-sm">불러오는 중...</div>
      ) : (
        <div className="flex flex-col gap-8">
          {reports.map(rep => (
            <LocationTable key={rep.location} rep={rep} onDownload={() => download(rep)} />
          ))}
        </div>
      )}
    </div>
  )
}

function LocationTable({ rep, onDownload }: { rep: LocationReport; onDownload: () => void }) {
  const maxRows = Math.max(0, ...rep.columns.map(c => c.rows.length))
  const hasData = rep.grandTotal > 0

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
        <span className="text-sm font-bold text-slate-800">
          {rep.dateStr} {rep.label} 배송 내역
        </span>
        <button
          onClick={onDownload}
          disabled={!hasData}
          className="flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white"
        >
          엑셀 다운로드
        </button>
      </div>

      {!hasData ? (
        <div className="px-4 py-10 text-center text-slate-400 text-sm">배송 내역이 없습니다.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr>
                {rep.columns.map(c => (
                  <th
                    key={c.riderId}
                    colSpan={4}
                    className="border border-slate-200 px-3 py-2 bg-blue-50 text-blue-800 font-bold text-center"
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
              <tr>
                {rep.columns.map(c => (
                  <FourHeaders key={c.riderId} />
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxRows }).map((_, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  {rep.columns.map(c => {
                    const row = c.rows[i]
                    return (
                      <FourCells
                        key={c.riderId}
                        clientName={row?.clientName ?? ''}
                        address={row?.address ?? ''}
                        orderTime={row?.orderTime ?? ''}
                        assignTime={row?.assignTime ?? ''}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {rep.columns.map(c => (
                  <td
                    key={c.riderId}
                    colSpan={4}
                    className="border border-slate-200 px-3 py-2 text-center font-semibold text-slate-700 bg-slate-50"
                  >
                    배송 {c.count}건
                  </td>
                ))}
              </tr>
              <tr>
                <td
                  colSpan={rep.columns.length * 4}
                  className="border border-slate-200 px-3 py-2 text-center font-bold text-slate-800 bg-amber-50"
                >
                  총 {rep.grandTotal}군데 배송
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

function FourHeaders() {
  const cls = 'border border-slate-200 px-3 py-1.5 bg-slate-100 text-slate-600 font-semibold text-center whitespace-nowrap'
  return (
    <>
      <th className={cls}>상호</th>
      <th className={cls}>주소</th>
      <th className={cls}>주문시각</th>
      <th className={cls}>배정시각</th>
    </>
  )
}

function FourCells({
  clientName,
  address,
  orderTime,
  assignTime,
}: {
  clientName: string
  address: string
  orderTime: string
  assignTime: string
}) {
  const cls = 'border border-slate-200 px-3 py-1.5 text-slate-700 whitespace-nowrap'
  return (
    <>
      <td className={`${cls} font-medium text-slate-800`}>{clientName}</td>
      <td className={cls}>{address}</td>
      <td className={`${cls} text-center text-slate-500`}>{orderTime}</td>
      <td className={`${cls} text-center text-blue-600`}>{assignTime}</td>
    </>
  )
}
