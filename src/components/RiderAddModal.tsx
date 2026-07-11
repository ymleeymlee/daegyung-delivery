'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Client } from '@/types'
import { supabase } from '@/lib/supabase'
import { groupByCode, groupLabel } from '@/lib/clientGroups'

interface Props {
  riderName: string
  onPick: (clientName: string, clientAddress: string, clientId?: string) => void
  onClose: () => void
}

// 이름블럭 아래 + 버튼용: 업체번호만 검색 → 선택 시 해당 라이더에 바로 배정
export default function RiderAddModal({ riderName, onPick, onClose }: Props) {
  const [code, setCode] = useState('')
  const [results, setResults] = useState<Client[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const q = code.trim()
    if (!q) { setResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .ilike('code', `%${q}%`)
        .limit(50)
      setResults(data ?? [])
    }, 180)
    return () => clearTimeout(timer)
  }, [code])

  const groups = groupByCode(results)

  function pick(name: string, address: string, id?: string) {
    onPick(name, address, id)
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[9999] p-4 pt-24" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-80 max-h-[70vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <span className="font-bold text-slate-800 text-sm">{riderName}에 추가 · 업체번호</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="p-3">
          <input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && groups.length > 0) {
                const g = groups[0]
                pick(groupLabel(g), g.rep.address, g.rep.id)
              }
              if (e.key === 'Escape') onClose()
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="업체번호 입력"
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3 flex flex-col gap-1">
          {code.trim() && groups.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">일치하는 업체번호가 없습니다.</p>
          )}
          {groups.map(g => (
            <button
              key={g.key}
              type="button"
              onClick={() => pick(groupLabel(g), g.rep.address, g.rep.id)}
              className="w-full text-left px-3 py-2.5 hover:bg-slate-50 active:bg-slate-100 rounded-xl border border-slate-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {g.code && <span className="text-xs text-slate-400 font-mono flex-shrink-0">{g.code}</span>}
                <span className="text-sm text-slate-800 font-medium truncate">{groupLabel(g)}</span>
                {g.members.length > 1 && <span className="text-xs text-blue-500 flex-shrink-0">{g.members.length}곳 묶음</span>}
              </div>
              <p className="text-xs text-slate-400 truncate">
                {g.members.length > 1 ? g.members.map(m => m.name).join(', ') : g.rep.address}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
