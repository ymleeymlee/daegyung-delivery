'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AppState, fetchAppState, effNow, kstNowHm } from '@/lib/appState'
import { Branch } from '@/types'

// 설정 페이지: 상단 톱니 버튼으로 진입.
// - 시트 업데이트 (Nav 에서 옮겨온 기능, 마감 아님·언제든 반복 가능)
// - 지점별 운영시간(open_time / close_time) 편집
export default function SettingsPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [updateDone, setUpdateDone] = useState(false)
  const [state, setState] = useState<AppState>({ offset: 0, closedUntil: null, minAppVersion: null })

  const refresh = useCallback(async () => { setState(await fetchAppState()) }, [])
  const fetchBranches = useCallback(async () => {
    const { data } = await supabase.from('branches').select('*').order('sort_order')
    setBranches((data ?? []) as Branch[])
  }, [])

  useEffect(() => {
    Promise.all([refresh(), fetchBranches()]).finally(() => setLoading(false))
    const ch = supabase
      .channel('settings-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, fetchBranches)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [refresh, fetchBranches])

  // 23:55~24:00 은 자동 마감(23:59) 준비시간 → 업데이트 비활성
  const kstHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(effNow(state.offset))
  const [bh, bm] = kstHM.split(':').map(Number)
  const blockWindow = bh === 23 && bm >= 55
  const nowHm = kstNowHm(state.offset)

  async function handleUpdate() {
    if (blockWindow) { alert('23:55~24:00 은 자동 마감 준비 시간이라 업데이트가 잠시 막힙니다.'); return }
    setUpdating(true)
    try {
      const res = await fetch('/api/update-sheets')
      const json = await res.json().catch(() => null) as { error?: string; updated?: string[] } | null
      if (res.ok) {
        setUpdateDone(true)
        setTimeout(() => setUpdateDone(false), 4000)
      } else {
        const done = json?.updated?.length ? `\n(성공: ${json.updated.join(', ')})` : ''
        alert('업데이트 실패: ' + (json?.error ?? res.statusText) + done)
      }
    } catch {
      alert('업데이트 실패')
    }
    setUpdating(false)
  }

  async function saveTime(code: string, field: 'open_time' | 'close_time', value: string) {
    const { error } = await supabase.from('branches').update({ [field]: value || null }).eq('code', code)
    if (error) alert('저장 실패: ' + error.message)
    else fetchBranches()
  }

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-bold text-slate-800">설정</h1>

      {/* 업데이트 카드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-800">시트 업데이트</h2>
            <p className="text-xs text-slate-500 mt-1">현재 내용을 배송·고품·위치 시트에 덮어쓰기 (마감 아님 · 언제든 반복 가능)</p>
          </div>
          <div className="flex items-center gap-3">
            {updateDone && (
              <span className="text-sm font-semibold text-green-600 animate-pulse">✓ 업데이트됨</span>
            )}
            <button
              onClick={handleUpdate}
              disabled={updating || blockWindow}
              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updating ? '업데이트 중...' : blockWindow ? '마감 준비중' : '업데이트'}
            </button>
          </div>
        </div>
      </section>

      {/* 지점별 운영시간(마감시간) 카드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">지점별 마감 시간</h2>
        <p className="text-xs text-slate-500 mb-4">
          운영 시작·종료 시각을 지정하면 그 시간 밖에는 자동으로 마감 상태로 표시되어 앱 위치공유·배송카드 생성이 차단됩니다.
        </p>
        {loading ? (
          <div className="text-sm text-slate-400">로딩 중...</div>
        ) : branches.length === 0 ? (
          <div className="text-sm text-slate-400">등록된 지점이 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-200">
                <th className="text-left font-medium py-2 w-24">지점</th>
                <th className="text-left font-medium py-2">시작 시간</th>
                <th className="text-left font-medium py-2">마감 시간</th>
                <th className="text-left font-medium py-2 w-20">현재</th>
              </tr>
            </thead>
            <tbody>
              {branches.map(b => {
                const isBranchClosedNow = (() => {
                  const open = b.open_time, close = b.close_time
                  if (!open || !close) return false
                  return nowHm < open || nowHm >= close
                })()
                return (
                  <tr key={b.code} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 font-semibold text-slate-700">{b.label}</td>
                    <td className="py-3">
                      <input
                        type="time"
                        defaultValue={b.open_time ?? ''}
                        onBlur={e => saveTime(b.code, 'open_time', e.target.value)}
                        className={inputCls}
                      />
                    </td>
                    <td className="py-3">
                      <input
                        type="time"
                        defaultValue={b.close_time ?? ''}
                        onBlur={e => saveTime(b.code, 'close_time', e.target.value)}
                        className={inputCls}
                      />
                    </td>
                    <td className="py-3">
                      {b.open_time && b.close_time ? (
                        isBranchClosedNow ? (
                          <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">마감</span>
                        ) : (
                          <span className="text-xs font-medium text-green-600">영업중</span>
                        )
                      ) : (
                        <span className="text-xs text-slate-400">미지정</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="text-xs text-slate-400 mt-3">
          값을 지우면 미지정 상태가 되어 24시간 열림 처리 · 자동 마감 배지도 뜨지 않습니다.
        </p>
      </section>
    </div>
  )
}
