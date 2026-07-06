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
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

// 고품 카드 (가로 한 줄)
function GopoumCard({
  gc, pickups, onUpdateQty, onDelete,
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
              onKeyDown={e => {
                if (e.key === 'Enter') saveQty()
                if (e.key === 'Escape') { setQtyInput(String(gc.total_quantity)); setEditingQty(false) }
              }}
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
        >×</button>
      </div>
    </div>
  )
}

export default function GopoumPage() {
  const [gopoumClients, setGopoumClients] = useState<GopoumClient[]>([])
  const [pickups, setPickups] = useState<GopoumPickup[]>([])

  // 항상 보이는 추가 폼 상태
  const [inputCode, setInputCode] = useState('')
  const [inputName, setInputName] = useState('')
  const [inputQty, setInputQty] = useState(1)
  const [suggestions, setSuggestions] = useState<Client[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const [adding, setAdding] = useState(false)
  const suggBoxRef = useRef<HTMLDivElement>(null)

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

  // 업체명/번호 자동완성
  useEffect(() => {
    const term = (inputCode || inputName).trim()
    if (!term) { setSuggestions([]); setShowSugg(false); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .or(`code.ilike.%${term}%,name.ilike.%${term}%`)
        .limit(6)
      setSuggestions(data ?? [])
      setShowSugg((data ?? []).length > 0)
    }, 180)
    return () => clearTimeout(timer)
  }, [inputCode, inputName])

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggBoxRef.current && !suggBoxRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function pickSuggestion(c: Client) {
    setInputCode(c.code)
    setInputName(c.name)
    setShowSugg(false)
    setSuggestions([])
  }

  async function handleAdd() {
    if (!inputName.trim() || adding) return
    setAdding(true)
    const { error } = await supabase.from('gopoum_clients').insert({
      client_id: null,
      client_code: inputCode.trim(),
      client_name: inputName.trim(),
      total_quantity: inputQty,
    })
    setAdding(false)
    if (!error) {
      // 추가 후 폼 초기화 → 바로 다시 추가 가능
      setInputCode('')
      setInputName('')
      setInputQty(1)
      setSuggestions([])
      setShowSugg(false)
    }
  }

  async function handleUpdateQty(id: string, qty: number) {
    setGopoumClients(prev => prev.map(gc => gc.id === id ? { ...gc, total_quantity: qty } : gc))
    const { error } = await supabase.from('gopoum_clients').update({ total_quantity: qty }).eq('id', id)
    if (error) fetchData()
  }

  async function handleDelete(id: string) {
    // 낙관적 업데이트
    setGopoumClients(prev => prev.filter(gc => gc.id !== id))
    setPickups(prev => prev.filter(p => p.gopoum_client_id !== id))
    const { error } = await supabase.from('gopoum_clients').delete().eq('id', id)
    if (error) {
      // 실패 시 복구
      fetchData()
    }
  }

  const sorted = [...gopoumClients].sort((a, b) => {
    const aRemaining = Math.max(0, a.total_quantity - pickups.filter(p => p.gopoum_client_id === a.id).reduce((s, p) => s + p.quantity, 0))
    const bRemaining = Math.max(0, b.total_quantity - pickups.filter(p => p.gopoum_client_id === b.id).reduce((s, p) => s + p.quantity, 0))
    if (aRemaining > 0 && bRemaining === 0) return -1
    if (aRemaining === 0 && bRemaining > 0) return 1
    return b.created_at.localeCompare(a.created_at)
  })

  const inputCls = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* 항상 고정된 추가 폼 */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0" ref={suggBoxRef}>
        <div className="flex items-center gap-2 flex-wrap relative">
          <input
            value={inputCode}
            onChange={e => { setInputCode(e.target.value); setInputName('') }}
            placeholder="업체번호"
            className={`${inputCls} w-28`}
          />
          <div className="relative">
            <input
              value={inputName}
              onChange={e => { setInputName(e.target.value); setInputCode('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !showSugg) handleAdd() }}
              placeholder="업체명"
              className={`${inputCls} w-44`}
            />
            {showSugg && suggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
                {suggestions.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickSuggestion(c)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      {c.code && <span className="text-xs text-slate-400 font-mono">{c.code}</span>}
                      <span className="text-sm text-slate-800 font-medium truncate">{c.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="number"
            min={1}
            value={inputQty}
            onChange={e => setInputQty(Math.max(1, parseInt(e.target.value) || 1))}
            className={`${inputCls} w-20 text-center`}
            placeholder="수량"
          />
          <button
            onClick={handleAdd}
            disabled={!inputName.trim() || adding}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {adding ? '추가 중...' : '+ 추가'}
          </button>
        </div>
      </div>

      {/* 카드 목록 */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* 컬럼 헤더 */}
        {sorted.length > 0 && (
          <div className="flex text-xs text-slate-400 font-semibold mb-1.5 px-1">
            <div className="w-16 flex-shrink-0 text-center">생성시간</div>
            <div className="w-20 flex-shrink-0 pl-2">업체번호</div>
            <div className="w-40 flex-shrink-0 pl-2">업체명</div>
            <div className="w-28 flex-shrink-0 text-center">찾아온/총수량</div>
            <div className="flex-1 pl-4">수거 기록 (배달자 · 수량 · 날짜시간)</div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {sorted.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-16">등록된 고품 업체가 없습니다.</div>
          )}
          {sorted.map(gc => (
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
    </div>
  )
}
