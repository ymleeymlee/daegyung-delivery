'use client'

import { useState, useEffect, useRef } from 'react'
import { Client } from '@/types'
import { supabase } from '@/lib/supabase'

interface Props {
  onAdd: (clientName: string, clientAddress: string, clientId?: string) => void
}

// 업체번호 / 상호명 / 주소 어디에 입력해도 검색되고, 배달 추가 시 바로 카드 생성
export default function QuickAddBar({ onAdd }: Props) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [results, setResults] = useState<Client[]>([])
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = term.trim()
    if (!q) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .or(`code.ilike.%${q}%,name.ilike.%${q}%,address.ilike.%${q}%`)
        .limit(8)
      setResults(data ?? [])
      setOpen(true)
    }, 180)
    return () => clearTimeout(timer)
  }, [term])

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function edit(field: 'code' | 'name' | 'address', value: string) {
    if (field === 'code') setCode(value)
    if (field === 'name') setName(value)
    if (field === 'address') setAddress(value)
    setSelectedId(undefined)
    setTerm(value)
  }

  function pick(c: Client) {
    setCode(c.code)
    setName(c.name)
    setAddress(c.address)
    setSelectedId(c.id)
    setResults([])
    setOpen(false)
    setTerm('')
  }

  function submit() {
    if (!name.trim()) return
    onAdd(name.trim(), address.trim(), selectedId)
    setCode('')
    setName('')
    setAddress('')
    setSelectedId(undefined)
    setResults([])
    setOpen(false)
    setTerm('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open && results.length > 0 && !selectedId) {
        pick(results[0])
      } else {
        submit()
      }
    }
  }

  const inputCls =
    'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div ref={boxRef} className="relative flex items-center gap-2 flex-wrap">
      <input
        value={code}
        onChange={e => edit('code', e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="업체번호"
        className={`${inputCls} w-24`}
      />
      <input
        value={name}
        onChange={e => edit('name', e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="상호명"
        className={`${inputCls} w-36`}
      />
      <input
        value={address}
        onChange={e => edit('address', e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="주소"
        className={`${inputCls} w-52`}
      />
      <button
        onClick={submit}
        disabled={!name.trim()}
        className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        <span className="text-base leading-none">+</span> 배달 추가
      </button>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c)}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
            >
              <div className="flex items-center gap-2">
                {c.code && (
                  <span className="text-xs text-slate-400 font-mono flex-shrink-0">{c.code}</span>
                )}
                <span className="text-sm text-slate-800 font-medium truncate">{c.name}</span>
              </div>
              <p className="text-xs text-slate-400 truncate">{c.address}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
