'use client'

import { useState, useEffect, useRef } from 'react'

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [maekamLoading, setMaekamLoading] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const [maekamDone, setMaekamDone] = useState(false)

  async function handleMaekam() {
    if (!confirm('오늘 마감을 실행하시겠습니까?\n\n· 배달 현황이 초기화됩니다\n· 오늘 기록이 배달/고품 내역에 저장됩니다\n· 고품 잔여 수량이 내일로 이월됩니다')) return
    setMaekamLoading(true)
    try {
      const res = await fetch('/api/close')
      if (res.ok) {
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
          <div className="absolute top-full left-0 mt-2 w-36 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
            <a href="/records" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">배달 내역</a>
            <a href="/gopoum-records" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">고품 내역</a>
            <a href="/clients" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">거래처 관리</a>
          </div>
        )}
      </div>

      {/* 마감 버튼 */}
      <div className="ml-auto flex items-center gap-3">
        {maekamDone && (
          <span className="text-sm font-semibold text-green-600 animate-pulse">✓ 마감되었습니다</span>
        )}
        <button
          onClick={handleMaekam}
          disabled={maekamLoading}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-sm font-semibold px-4 py-1.5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {maekamLoading ? '마감 중...' : '마감'}
        </button>
      </div>
    </nav>
  )
}
