'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { AppState, fetchAppState, setDateOffset, clearClosed, effNow, isClosedNow } from '@/lib/appState'

const sheetUrl = process.env.NEXT_PUBLIC_SHEET_URL ?? 'https://drive.google.com/drive/folders/1FFu4_whlCpr1YcOCaifBlwGi8h2S-z5K'

function fmtKstDate(d: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short',
  }).format(d)
}

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [maekamLoading, setMaekamLoading] = useState(false)
  const [maekamDone, setMaekamDone] = useState(false)
  const [state, setState] = useState<AppState>({ offset: 0, closedUntil: null })
  const menuRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => { setState(await fetchAppState()) }, [])

  useEffect(() => {
    refresh()
    const channel = supabase
      .channel('app-state-nav')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, refresh)
      .subscribe()
    // 자정 넘어가며 마감 자동 해제 반영용 (1분마다 상태 재평가)
    const timer = setInterval(() => setState(s => ({ ...s })), 60000)
    return () => { supabase.removeChannel(channel); clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const closed = isClosedNow(state)
  const displayDate = fmtKstDate(effNow(state.offset))

  async function handleMaekam() {
    if (closed) return
    if (!confirm('오늘 마감을 실행하시겠습니까?\n\n· 배달 현황이 초기화됩니다\n· 수거한 고품은 정리되고 미수거만 남습니다\n· 오늘 기록이 시트에 확정됩니다')) return
    setMaekamLoading(true)
    try {
      const res = await fetch('/api/close')
      if (res.ok) {
        await refresh()
        setMaekamDone(true)
        setTimeout(() => setMaekamDone(false), 4000)
      } else {
        alert('마감 실패: ' + (await res.text()))
      }
    } catch {
      alert('마감 실패')
    }
    setMaekamLoading(false)
  }

  async function handleNextDay() {
    // 테스트용: 하루 앞으로 이동하며 마감 강제 해제 (다음날 06시 넘긴 상태)
    await setDateOffset(state.offset + 1)
    await clearClosed()
    await refresh()
  }

  async function handleResetToday() {
    // 테스트용: 실제 오늘(offset 0)로 복구 + 마감 해제
    await setDateOffset(0)
    await clearClosed()
    await refresh()
  }

  return (
    <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6 shadow-sm">
      <span className="text-lg font-bold text-slate-800">대경배달시스템</span>
      <a href="/" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">배달 현황</a>
      <a href="/gopoum" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">고품 현황</a>

      {/* 관리 드롭다운 */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(v => !v)}
          className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors"
        >
          관리
          <svg className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute top-full left-0 mt-2 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
            <a href={sheetUrl} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)} className="flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
              배달·고품 내역 <span className="text-xs text-green-600">시트 ↗</span>
            </a>
            <a href="/clients" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">거래처 관리</a>
            <a href="/riders" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">라이더 관리</a>
          </div>
        )}
      </div>

      {/* 우측: 날짜 + 마감 + 테스트 */}
      <div className="ml-auto flex items-center gap-3">
        {maekamDone && (
          <span className="text-sm font-semibold text-green-600 animate-pulse">✓ 마감되었습니다</span>
        )}
        <span className={`text-sm font-medium ${state.offset > 0 ? 'text-purple-600' : 'text-slate-500'}`}>
          {displayDate}{state.offset > 0 ? ` (+${state.offset})` : ''}
        </span>
        <button
          onClick={handleMaekam}
          disabled={maekamLoading || closed}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-sm font-semibold px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {maekamLoading ? '마감 중...' : closed ? '마감됨' : '마감'}
        </button>
        {/* 테스트용: 다음날로 강제 이동 */}
        <button
          onClick={handleNextDay}
          className="text-xs border border-purple-300 text-purple-600 hover:bg-purple-50 px-2.5 py-1.5 rounded-xl transition-colors"
          title="테스트용: 하루 앞으로"
        >
          다음날 →
        </button>
        {/* 테스트용: 실제 오늘로 리셋 (offset > 0일 때만) */}
        {state.offset > 0 && (
          <button
            onClick={handleResetToday}
            className="text-xs border border-slate-300 text-slate-500 hover:bg-slate-50 px-2.5 py-1.5 rounded-xl transition-colors"
            title="테스트용: 실제 오늘로 복구"
          >
            오늘로 리셋
          </button>
        )}
      </div>
    </nav>
  )
}
