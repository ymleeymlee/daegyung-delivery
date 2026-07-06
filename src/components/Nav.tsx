'use client'

import { useState, useEffect, useRef } from 'react'

export default function Nav() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6 shadow-sm">
      <span className="text-lg font-bold text-slate-800">대경배달시스템</span>
      <a href="/" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">배달 현황</a>
      <a href="/gopoum" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">고품 현황</a>

      {/* 관리 드롭다운 */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors"
        >
          관리
          <svg
            className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute top-full left-0 mt-2 w-36 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
            <a href="/records" onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
              배달 내역
            </a>
            <a href="/gopoum-records" onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">
              고품 내역
            </a>
            <a href="/clients" onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-t border-slate-100">
              거래처 관리
            </a>
          </div>
        )}
      </div>
    </nav>
  )
}
