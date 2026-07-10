'use client'

import { useState, useEffect, useRef } from 'react'
import { Client } from '@/types'
import { supabase } from '@/lib/supabase'

interface Props {
  onAdd: (clientName: string, clientAddress: string, clientId?: string) => void
}

// 업체번호가 같은 거래처들을 하나로 묶은 그룹
interface Group {
  key: string
  code: string
  rep: Client        // 대표 거래처
  members: Client[]
}

// 검색 결과를 업체번호 기준으로 그룹핑 (업체번호 없으면 개별)
function groupByCode(list: Client[]): Group[] {
  const byCode = new Map<string, Client[]>()
  const singles: Client[] = []
  for (const c of list) {
    const code = (c.code ?? '').trim()
    if (code) {
      if (!byCode.has(code)) byCode.set(code, [])
      byCode.get(code)!.push(c)
    } else {
      singles.push(c)
    }
  }
  const groups: Group[] = []
  for (const [code, members] of byCode) {
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    groups.push({ key: code, code, rep: sorted[0], members: sorted })
  }
  for (const s of singles) groups.push({ key: s.id, code: '', rep: s, members: [s] })
  return groups
}

// 그룹 표시명: "경기모터스 외 3" (묶인 게 있으면), 아니면 상호명 그대로
function groupLabel(g: Group): string {
  return g.members.length > 1 ? `${g.rep.name} 외 ${g.members.length - 1}` : g.rep.name
}

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
        .limit(50)
      setResults(data ?? [])
      setOpen(true)
    }, 180)
    return () => clearTimeout(timer)
  }, [term])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const groups = groupByCode(results)

  function edit(field: 'code' | 'name' | 'address', value: string) {
    if (field === 'code') setCode(value)
    if (field === 'name') setName(value)
    if (field === 'address') setAddress(value)
    setSelectedId(undefined)
    setTerm(value)
  }

  // 그룹 선택 → 대표 정보 + 묶음 표시명으로 입력칸 채움
  function pickGroup(g: Group) {
    setCode(g.code)
    setName(groupLabel(g))
    setAddress(g.rep.address)
    setSelectedId(g.rep.id)
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
      if (open && groups.length > 0 && !selectedId) {
        pickGroup(groups[0])
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
        <span className="text-base leading-none">+</span> 배송 추가
      </button>

      {open && groups.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden max-h-80 overflow-y-auto">
          {groups.map(g => (
            <button
              key={g.key}
              type="button"
              onClick={() => pickGroup(g)}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
            >
              <div className="flex items-center gap-2">
                {g.code && (
                  <span className="text-xs text-slate-400 font-mono flex-shrink-0">{g.code}</span>
                )}
                <span className="text-sm text-slate-800 font-medium truncate">{groupLabel(g)}</span>
                {g.members.length > 1 && (
                  <span className="text-xs text-blue-500 flex-shrink-0">{g.members.length}곳 묶음</span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate">
                {g.members.length > 1
                  ? g.members.map(m => m.name).join(', ')
                  : g.rep.address}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
