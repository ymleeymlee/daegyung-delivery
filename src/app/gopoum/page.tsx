'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { GopoumClient, GopoumPickup, Client } from '@/types'

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

// 업체 추가 인라인 폼
function AddForm({
  onAdd,
  onCancel,
}: {
  onAdd: (code: string, name: string, clientId: string | undefined, qty: number) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState(1)
  const [clientId, setClientId] = useState<string | undefined>()
  const [suggestions, setSuggestions] = useState<Client[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const [term, setTerm] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = term.trim()
    if (!q) { setSuggestions([]); setShowSugg(false); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
        .limit(8)
      setSuggestions(data ?? [])
      setShowSugg(true)
    }, 180)
    return () => clearTimeout(timer)
  }, [term])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function pick(c: Client) {
    setCode(c.code)
    setName(c.name)
    setClientId(c.id)
    setSuggestions([])
    setShowSugg(false)
    setTerm('')
  }

  function editField(field: 'code' | 'name', val: string) {
    if (field === 'code') setCode(val)
    if (field === 'name') setName(val)
    setClientId(undefined)
    setTerm(val)
  }

  const inputCls = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div ref={boxRef} className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-4 flex items-end gap-3 flex-wrap relative">
      <div>
        <label className="text-xs text-slate-500 block mb-1">업체번호</label>
        <input
          value={code}
          onChange={e => editField('code', e.target.value)}
          placeholder="업체번호"
          className={`${inputCls} w-28`}
        />
      </div>
      <div className="relative">
        <label className="text-xs text-slate-500 block mb-1">업체명 *</label>
        <input
          autoFocus
          value={name}
          onChange={e => editField('name', e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (showSugg && suggestions.length > 0) pick(suggestions[0])
              else if (name.trim()) onAdd(code.trim(), name.trim(), clientId, qty)
            }
            if (e.key === 'Escape') onCancel()
          }}
          placeholder="업체명"
          className={`${inputCls} w-44`}
        />
        {showSugg && suggestions.length > 0 && (
          <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
            {suggestions.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
              >
                <div className="flex items-center gap-2">
                  {c.code && <span className="text-xs text-slate-400 font-mono">{c.code}</span>}
                  <span className="text-sm text-slate-800 font-medium truncate">{c.name}</span>
                </div>
                <p className="text-xs text-slate-400 truncate">{c.address}</p>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="text-xs text-slate-500 block mb-1">총 고품 수량</label>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
          className={`${inputCls} w-20 text-center`}
        />
      </div>
      <button
        onClick={() => { if (name.trim()) onAdd(code.trim(), name.trim(), clientId, qty) }}
        disabled={!name.trim()}
        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        추가
      </button>
      <button
        onClick={onCancel}
        className="text-slate-500 hover:text-slate-700 text-sm px-3 py-1.5 transition-colors"
      >
        취소
      </button>
    </div>
  )
}

// 고품 카드 (가로 한 줄)
function GopoumCard({
  gc,
  pickups,
  onUpdateQty,
  onDelete,
}: {
  gc: GopoumClient
  pickups: GopoumPickup[]
  onUpdateQty: (id: string, qty: number) => void
  onDelete: (id: string) => void
}) {
  const [editingQty, setEditingQty] = useState(false)
  const [qtyInput, setQtyInput] = useState(String(gc.total_quantity))

  useEffect(() => { setQtyInput(String(gc.total_quantity)) }, [gc.total_quantity])

  const pickedTotal = pickups.reduce((sum, p) => sum + p.quantity, 0)
  const remaining = Math.max(0, gc.total_quantity - pickedTotal)

  function saveQty() {
    const n = parseInt(qtyInput)
    if (!isNaN(n) && n >= 0) onUpdateQty(gc.id, n)
    else setQtyInput(String(gc.total_quantity))
    setEditingQty(false)
  }

  const sortedPickups = [...pickups].sort((a, b) => a.picked_at.localeCompare(b.picked_at))

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden flex text-sm min-h-14 ${remaining > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
      {/* 생성시간 */}
      <div className="w-16 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center text-center">
        <span className="text-xs text-slate-400">{fmtDate(gc.created_at)}</span>
        <span className="text-xs text-slate-500 font-medium">{fmtTime(gc.created_at)}</span>
      </div>

      {/* 업체번호 */}
      <div className="w-20 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center">
        <span className="text-xs text-slate-500">{gc.client_code || '-'}</span>
      </div>

      {/* 업체명 */}
      <div className="w-40 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center">
        <span className="font-semibold text-slate-800 truncate">{gc.client_name}</span>
      </div>

      {/* 수거 현황 */}
      <div className="w-28 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center gap-0.5">
        <div className="flex items-baseline gap-0.5">
          <span className={`text-base font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            {pickedTotal}
          </span>
          <span className="text-slate-300 text-xs mx-0.5">/</span>
          {editingQty ? (
            <input
              autoFocus
              type="number"
              value={qtyInput}
              min={0}
              onChange={e => setQtyInput(e.target.value)}
              onBlur={saveQty}
              onKeyDown={e => { if (e.key === 'Enter') saveQty(); if (e.key === 'Escape') { setQtyInput(String(gc.total_quantity)); setEditingQty(false) } }}
              className="w-10 border border-blue-300 rounded px-1 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          ) : (
            <button
              onClick={() => setEditingQty(true)}
              className="text-sm text-slate-700 hover:text-blue-600 hover:underline font-medium"
              title="총 수량 수정"
            >
              {gc.total_quantity}
            </button>
          )}
        </div>
        <span className={`text-xs ${remaining > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
          {remaining > 0 ? `잔여 ${remaining}개` : '완료'}
        </span>
      </div>

      {/* 수거 기록 */}
      <div className="flex-1 min-w-0 divide-y divide-slate-100">
        {sortedPickups.length === 0 ? (
          <div className="px-4 py-3 text-xs text-slate-300 italic flex items-center h-full">수거 기록 없음</div>
        ) : (
          sortedPickups.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-16 text-slate-700 font-medium truncate flex-shrink-0">{p.rider_name}</span>
              <span className="w-10 text-amber-700 font-semibold text-center flex-shrink-0">{p.quantity}개</span>
              <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(p.picked_at)}</span>
            </div>
          ))
        )}
      </div>

      {/* 삭제 */}
      <div className="w-8 flex-shrink-0 flex items-center justify-center border-l border-slate-100">
        <button
          onClick={() => { if (confirm('고품 기록을 삭제하시겠습니까?')) onDelete(gc.id) }}
          className="text-slate-300 hover:text-red-400 text-xl leading-none transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  )
}

export default function GopoumPage() {
  const [gopoumClients, setGopoumClients] = useState<GopoumClient[]>([])
  const [pickups, setPickups] = useState<GopoumPickup[]>([])
  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const fetchData = useCallback(async () => {
    const [{ data: gClients }, { data: gPickups }] = await Promise.all([
      supabase.from('gopoum_clients').select('*').order('created_at', { ascending: false }),
      supabase.from('gopoum_pickups').select('*'),
    ])
    setGopoumClients(gClients ?? [])
    setPickups(gPickups ?? [])
  }, [])

  useEffect(() => {
    fetchData()
    const channel = supabase
      .channel('gopoum-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_clients' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_pickups' }, fetchData)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  // 잔여 있는 항목 먼저, 그 다음 생성시간 최신순
  const filtered = gopoumClients
    .filter(gc => !search || gc.client_name.includes(search) || gc.client_code.includes(search))
    .sort((a, b) => {
      const aRemaining = Math.max(0, a.total_quantity - pickups.filter(p => p.gopoum_client_id === a.id).reduce((s, p) => s + p.quantity, 0))
      const bRemaining = Math.max(0, b.total_quantity - pickups.filter(p => p.gopoum_client_id === b.id).reduce((s, p) => s + p.quantity, 0))
      if (aRemaining > 0 && bRemaining === 0) return -1
      if (aRemaining === 0 && bRemaining > 0) return 1
      return b.created_at.localeCompare(a.created_at)
    })

  async function handleAdd(code: string, name: string, clientId: string | undefined, qty: number) {
    const { error } = await supabase.from('gopoum_clients').insert({
      client_id: clientId ?? null,
      client_code: code,
      client_name: name,
      total_quantity: qty,
    })
    if (!error) setShowAddForm(false)
  }

  async function handleUpdateQty(id: string, qty: number) {
    setGopoumClients(prev => prev.map(gc => gc.id === id ? { ...gc, total_quantity: qty } : gc))
    supabase.from('gopoum_clients').update({ total_quantity: qty }).eq('id', id).then(({ error }) => {
      if (error) fetchData()
    })
  }

  async function handleDelete(id: string) {
    setGopoumClients(prev => prev.filter(gc => gc.id !== id))
    setPickups(prev => prev.filter(p => p.gopoum_client_id !== id))
    supabase.from('gopoum_clients').delete().eq('id', id)
  }

  return (
    <div className="p-6 max-w-full">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="업체번호 / 업체명 검색..."
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-64"
        />
        <button
          onClick={() => setShowAddForm(v => !v)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap"
        >
          + 업체 추가
        </button>
      </div>

      {showAddForm && (
        <AddForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />
      )}

      {/* 컬럼 헤더 */}
      {filtered.length > 0 && (
        <div className="flex text-xs text-slate-400 font-semibold mb-1.5 px-1">
          <div className="w-16 flex-shrink-0 text-center">생성시간</div>
          <div className="w-20 flex-shrink-0 pl-2">업체번호</div>
          <div className="w-40 flex-shrink-0 pl-2">업체명</div>
          <div className="w-28 flex-shrink-0 text-center">찾아온/총수량</div>
          <div className="flex-1 pl-4">수거 기록 (배달자 · 수량 · 날짜시간)</div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtered.length === 0 && (
          <div className="text-center text-slate-400 text-sm py-16">
            {search ? '검색 결과가 없습니다.' : '등록된 고품 업체가 없습니다.'}
          </div>
        )}
        {filtered.map(gc => (
          <GopoumCard
            key={gc.id}
            gc={gc}
            pickups={pickups.filter(p => p.gopoum_client_id === gc.id)}
            onUpdateQty={handleUpdateQty}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  )
}
