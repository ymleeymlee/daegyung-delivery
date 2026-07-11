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
      <div className="flex gap-4 items-stretch" onClick={e => e.stopPropagation()}>

        {/* 왼쪽 블록: 검색 결과 리스트 */}
        <div className="bg-white rounded-2xl shadow-xl w-64 h-[28rem] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <span className="font-bold text-slate-800 text-sm">검색 결과</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {code.trim() && groups.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">일치하는 업체번호가 없습니다.</p>
            )}
            {!code.trim() && (
              <p className="text-sm text-slate-300 text-center py-6">업체번호를 입력하세요.</p>
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

        {/* 오른쪽 블록: 업체번호 입력 + 아래 키패드 */}
        <div className="bg-white rounded-2xl shadow-xl w-64 h-[28rem] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <span className="font-bold text-slate-800 text-sm truncate">{riderName} · 업체번호</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none flex-shrink-0 ml-2">×</button>
          </div>
          <div className="p-3 flex flex-col gap-3">
            <input
              ref={inputRef}
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={e => {
                if (e.key === 'Enter' && groups.length > 0) {
                  const g = groups[0]
                  pick(groupLabel(g), g.rep.address, g.rep.id)
                }
                if (e.key === 'Escape') onClose()
              }}
              inputMode="none"
              placeholder="업체번호 입력"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-lg tracking-wide bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />

            {/* 직접 그린 숫자 키패드. OS 터치 키보드 대신, 하드웨어 키보드 숫자도 입력됨 */}
            <div className="grid grid-cols-3 gap-2" onMouseDown={e => e.preventDefault()}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                <button key={d} type="button" onClick={() => setCode(c => c + d)}
                  className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-xl font-semibold text-slate-800 transition-colors">
                  {d}
                </button>
              ))}
              <button type="button" onClick={() => setCode('')}
                className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-sm font-semibold text-slate-500 transition-colors">
                전체삭제
              </button>
              <button type="button" onClick={() => setCode(c => c + '0')}
                className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-xl font-semibold text-slate-800 transition-colors">
                0
              </button>
              <button type="button" onClick={() => setCode(c => c.slice(0, -1))}
                className="py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-xl font-semibold text-slate-500 transition-colors">
                ⌫
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
