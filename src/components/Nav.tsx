'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
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
  const [updating, setUpdating] = useState(false)
  const [updateDone, setUpdateDone] = useState(false)
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
  // 23:55~24:00 은 자동 마감(23:59) 준비시간 → 업데이트 비활성 (1분 타이머로 재평가됨)
  const kstHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(effNow(state.offset))
  const [bh, bm] = kstHM.split(':').map(Number)
  const blockWindow = bh === 23 && bm >= 55

  // 업데이트: DB 는 그대로 두고 현재 내용을 각 시트에 덮어쓰기. 마감 아님·반복 가능.
  async function handleUpdate() {
    if (blockWindow) { alert('23:55~24:00 은 자동 마감 준비 시간이라 업데이트가 잠시 막힙니다.'); return }
    setUpdating(true)
    try {
      const res = await fetch('/api/update-sheets')
      if (res.ok) {
        setUpdateDone(true)
        setTimeout(() => setUpdateDone(false), 4000)
      } else {
        alert('업데이트 실패: ' + (await res.text()))
      }
    } catch {
      alert('업데이트 실패')
    }
    setUpdating(false)
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
      <span className="text-lg font-bold text-slate-800">대경배송시스템</span>
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">배송 현황</Link>
      <Link href="/gopoum" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">고품 현황</Link>

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
              배송·고품 내역 <span className="text-xs text-green-600">시트 ↗</span>
            </a>
            <Link href="/tracking" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">실시간 위치</Link>
            <Link href="/clients" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">거래처 관리</Link>
            <Link href="/riders" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">라이더 관리</Link>
          </div>
        )}
      </div>

      {/* 우측: 날짜 + 마감 + 테스트 */}
      <div className="ml-auto flex items-center gap-3">
        {updateDone && (
          <span className="text-sm font-semibold text-green-600 animate-pulse">✓ 시트 업데이트됨</span>
        )}
        {closed && !updateDone && (
          <span className="text-xs font-medium text-slate-400" title="매일 23:59 자동 마감됨 (다음날 06시 해제)">🔒 자동마감됨</span>
        )}
        <span className={`text-sm font-medium ${state.offset > 0 ? 'text-purple-600' : 'text-slate-500'}`}>
          {displayDate}{state.offset > 0 ? ` (+${state.offset})` : ''}
        </span>
        <button
          onClick={handleUpdate}
          disabled={updating || blockWindow}
          title="현재 내용을 배송·고품·위치 시트에 덮어쓰기 (마감 아님 · 언제든 반복 가능)"
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {updating ? '업데이트 중...' : blockWindow ? '마감 준비중' : '업데이트'}
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
