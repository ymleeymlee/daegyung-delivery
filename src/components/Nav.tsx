'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AppState, DEFAULT_BUSINESS_OPEN, DEFAULT_BUSINESS_CLOSE, fetchAppState, setDateOffset, clearClosed, effNow, isClosedNow, isBusinessClosed, kstNowHm } from '@/lib/appState'
import { useBranch } from '@/lib/branch'

function fmtKstDate(d: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short',
  }).format(d)
}

export default function Nav() {
  const { branch, setBranch, branches } = useBranch()
  const [menuOpen, setMenuOpen] = useState(false)
  const [state, setState] = useState<AppState>({ offset: 0, closedUntil: null, minAppVersion: null, businessOpen: DEFAULT_BUSINESS_OPEN, businessClose: DEFAULT_BUSINESS_CLOSE })
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
    // 다음날(00시) 자동 수행 트리거. 서버가 idempotent(하루 한 번만 실행) — 그냥 매 마운트 호출.
    // 마감 자동 수행 트리거도 동일 방식. 서버가 close_time 지났는지·오늘 실행했는지 판정.
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
      if (localStorage.getItem('midnight-check-date') !== today) {
        fetch('/api/midnight-check').then(r => r.ok && localStorage.setItem('midnight-check-date', today)).catch(() => {})
      }
      // close-check 는 시각 판정이 서버에서 이뤄지므로 localStorage 캐시 사용하지 않음
      // (오전에 호출 → 아직 이르다고 skip → 저녁에 다시 호출 시 실행되어야 하기 때문)
      fetch('/api/close-check').catch(() => {})
    } catch { /* noop */ }
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
  // 전역 영업시간 기준 마감 배지
  const nowHm = kstNowHm(state.offset)
  const businessClosed = isBusinessClosed(nowHm, state.businessOpen, state.businessClose)
  const displayDate = fmtKstDate(effNow(state.offset))

  async function handleResetToday() {
    // 테스트용: 실제 오늘(offset 0)로 복구 + 마감 해제
    await setDateOffset(0)
    await clearClosed()
    await refresh()
  }

  return (
    <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6 shadow-sm">
      <span className="text-lg font-bold text-slate-800">대경배송시스템</span>
      {branches.length > 0 && (
        <select
          value={branch}
          onChange={e => setBranch(e.target.value)}
          className="text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
          title="지점 선택"
        >
          {branches.map(b => (
            <option key={b.code} value={b.code}>{b.label}</option>
          ))}
        </select>
      )}
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">배송 현황</Link>
      <Link href="/gopoum" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">고품 현황</Link>
      <Link href="/tracking" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">실시간 위치</Link>

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
            <Link href="/clients" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">거래처 관리</Link>
          </div>
        )}
      </div>

      {/* 우측: 날짜 + 마감 배지 + 톱니(설정) */}
      <div className="ml-auto flex items-center gap-3">
        {businessClosed && (
          <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full" title="운영시간 외 — 앱 위치공유 종료 및 배송카드 생성 차단">마감</span>
        )}
        {closed && !businessClosed && (
          <span className="text-xs font-medium text-slate-400" title="매일 23:59 자동 마감됨 (다음날 06시 해제)">🔒 자동마감됨</span>
        )}
        <span className={`text-sm font-medium ${state.offset > 0 ? 'text-purple-600' : 'text-slate-500'}`}>
          {displayDate}{state.offset > 0 ? ` (+${state.offset})` : ''}
        </span>
        {/* 설정 (톱니) */}
        <Link
          href="/settings"
          title="설정"
          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.076.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.242-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </Link>
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
