'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { GopoumClient, GopoumItem, Client } from '@/types'

function todayStartIso() {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  return new Date(`${d}T00:00:00+09:00`).toISOString()
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}
function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

function GopoumCard({
  gc, items, todayStart, onDelete, onAddItem, onUpdateStartedAt,
}: {
  gc: GopoumClient
  items: GopoumItem[]
  todayStart: string
  onDelete: (id: string) => void
  onAddItem: (clientId: string, description: string) => void
  onUpdateStartedAt: (id: string) => void
}) {
  const [showAddItem, setShowAddItem] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (showAddItem) inputRef.current?.focus() }, [showAddItem])

  const todayCollected = items.filter(i => i.picked_at && i.picked_at >= todayStart).length
  const total = items.length
  const remaining = items.filter(i => !i.picked_at).length

  function submitItem() {
    if (!newDesc.trim()) return
    onAddItem(gc.id, newDesc.trim())
    setNewDesc('')
    setShowAddItem(false)
    // started_at 최초 아이템 추가 시 설정
    if (items.length === 0) onUpdateStartedAt(gc.id)
  }

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden text-sm ${remaining > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex min-h-14">
        {/* 생성시간 */}
        <div className="w-16 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center text-center">
          {gc.started_at ? (
            <>
              <span className="text-xs text-slate-400">{fmtDate(gc.started_at)}</span>
              <span className="text-xs text-slate-500 font-medium">{fmtTime(gc.started_at)}</span>
            </>
          ) : (
            <span className="text-xs text-slate-300">-</span>
          )}
        </div>

        {/* 업체번호 */}
        <div className="w-20 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center">
          <span className="text-xs text-slate-500">{gc.client_code || '-'}</span>
        </div>

        {/* 업체명 */}
        <div className="w-40 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center">
          <span className="font-semibold text-slate-800 truncate">{gc.client_name}</span>
        </div>

        {/* 수거 현황 + 고품추가 */}
        <div className="w-32 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center gap-1">
          <div className="flex items-baseline gap-0.5">
            <span className={`text-base font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>{todayCollected}</span>
            <span className="text-slate-300 text-xs mx-0.5">/</span>
            <span className="text-sm font-bold text-slate-700">{total}</span>
          </div>
          <span className={`text-xs ${remaining > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
            {remaining > 0 ? `잔여 ${remaining}개` : total > 0 ? '완료' : '없음'}
          </span>
          <button
            onClick={() => setShowAddItem(v => !v)}
            className="mt-0.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap"
          >
            + 고품추가
          </button>
        </div>

        {/* 아이템 목록 */}
        <div className="flex-1 min-w-0 divide-y divide-slate-100">
          {items.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-300 italic flex items-center h-full">품목 없음</div>
          ) : (
            [...items].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(item => (
              <div key={item.id} className={`flex items-center gap-2 px-4 py-2 ${item.picked_at ? 'bg-green-50' : ''}`}>
                <span className={`flex-1 text-sm truncate ${item.picked_at ? 'text-green-700 line-through' : 'text-slate-700 font-medium'}`}>
                  {item.description}
                </span>
                {item.picked_at ? (
                  <span className="text-xs text-green-600 whitespace-nowrap flex-shrink-0">
                    ✓ {item.rider_name} {fmtDateTime(item.picked_at)}
                  </span>
                ) : (
                  <span className="text-xs text-amber-400 flex-shrink-0">미수거</span>
                )}
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

      {/* 고품 추가 인라인 폼 */}
      {showAddItem && (
        <div className="border-t border-blue-100 bg-blue-50 px-4 py-2 flex items-center gap-2">
          <input
            ref={inputRef}
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitItem(); if (e.key === 'Escape') { setShowAddItem(false); setNewDesc('') } }}
            placeholder="품목명 입력 (예: 박스 큰거)"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button onClick={submitItem} disabled={!newDesc.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">
            추가
          </button>
          <button onClick={() => { setShowAddItem(false); setNewDesc('') }}
            className="text-slate-400 hover:text-slate-600 text-sm px-2 py-1.5 transition-colors">
            취소
          </button>
        </div>
      )}
    </div>
  )
}

export default function GopoumPage() {
  const [gopoumClients, setGopoumClients] = useState<GopoumClient[]>([])
  const [gopoumItems, setGopoumItems] = useState<GopoumItem[]>([])
  const [todayStart] = useState(todayStartIso)

  const [inputCode, setInputCode] = useState('')
  const [inputName, setInputName] = useState('')
  const [suggestions, setSuggestions] = useState<Client[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const [adding, setAdding] = useState(false)
  const suggBoxRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    const [{ data: gClients }, { data: gItems }] = await Promise.all([
      supabase.from('gopoum_clients').select('*').order('created_at', { ascending: true }),
      supabase.from('gopoum_items').select('*').or(`picked_at.is.null,picked_at.gte.${todayStart}`),
    ])
    setGopoumClients(gClients ?? [])
    setGopoumItems(gItems ?? [])
  }, [todayStart])

  useEffect(() => {
    fetchData()
    const channel = supabase
      .channel('gopoum-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_clients' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_items' }, fetchData)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  useEffect(() => {
    const term = (inputCode || inputName).trim()
    if (!term) { setSuggestions([]); setShowSugg(false); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('clients').select('*').or(`code.ilike.%${term}%,name.ilike.%${term}%`).limit(6)
      setSuggestions(data ?? [])
      setShowSugg((data ?? []).length > 0)
    }, 180)
    return () => clearTimeout(timer)
  }, [inputCode, inputName])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggBoxRef.current && !suggBoxRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleAdd() {
    if (!inputName.trim() || adding) return
    setAdding(true)
    const { error } = await supabase.from('gopoum_clients').insert({
      client_id: null,
      client_code: inputCode.trim(),
      client_name: inputName.trim(),
      total_quantity: 0,
      started_at: null,
    })
    setAdding(false)
    if (!error) { setInputCode(''); setInputName(''); setSuggestions([]); setShowSugg(false) }
  }

  async function handleAddItem(clientId: string, description: string) {
    const { data } = await supabase.from('gopoum_items').insert({
      gopoum_client_id: clientId,
      description,
    }).select().single()
    if (data) {
      setGopoumItems(prev => [...prev, data])
      // total_quantity도 갱신
      const newTotal = gopoumItems.filter(i => i.gopoum_client_id === clientId).length + 1
      supabase.from('gopoum_clients').update({ total_quantity: newTotal }).eq('id', clientId)
    }
  }

  async function handleUpdateStartedAt(clientId: string) {
    const now = new Date().toISOString()
    setGopoumClients(prev => prev.map(gc => gc.id === clientId ? { ...gc, started_at: now } : gc))
    supabase.from('gopoum_clients').update({ started_at: now }).eq('id', clientId)
  }

  async function handleDelete(id: string) {
    setGopoumClients(prev => prev.filter(gc => gc.id !== id))
    setGopoumItems(prev => prev.filter(i => i.gopoum_client_id !== id))
    const { error } = await supabase.from('gopoum_clients').delete().eq('id', id)
    if (error) fetchData()
  }

  const inputCls = 'border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* 업체 추가 폼 */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0" ref={suggBoxRef}>
        <div className="flex items-center gap-2 flex-wrap relative">
          <input value={inputCode} onChange={e => { setInputCode(e.target.value); setInputName('') }} placeholder="업체번호" className={`${inputCls} w-28`} />
          <div className="relative">
            <input value={inputName} onChange={e => { setInputName(e.target.value); setInputCode('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !showSugg) handleAdd() }}
              placeholder="업체명" className={`${inputCls} w-44`} />
            {showSugg && suggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
                {suggestions.map(c => (
                  <button key={c.id} type="button" onClick={() => { setInputCode(c.code); setInputName(c.name); setShowSugg(false) }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-2">
                      {c.code && <span className="text-xs text-slate-400 font-mono">{c.code}</span>}
                      <span className="text-sm text-slate-800 font-medium truncate">{c.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleAdd} disabled={!inputName.trim() || adding}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40 whitespace-nowrap">
            {adding ? '추가 중...' : '+ 업체 추가'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {gopoumClients.length > 0 && (
          <div className="flex text-xs text-slate-400 font-semibold mb-1.5 px-1">
            <div className="w-16 flex-shrink-0 text-center">생성시간</div>
            <div className="w-20 flex-shrink-0 pl-2">업체번호</div>
            <div className="w-40 flex-shrink-0 pl-2">업체명</div>
            <div className="w-32 flex-shrink-0 text-center">찾아온/총수량</div>
            <div className="flex-1 pl-4">품목 목록</div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {gopoumClients.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-16">등록된 고품 업체가 없습니다.</div>
          )}
          {gopoumClients.map(gc => (
            <GopoumCard
              key={gc.id}
              gc={gc}
              items={gopoumItems.filter(i => i.gopoum_client_id === gc.id)}
              todayStart={todayStart}
              onDelete={handleDelete}
              onAddItem={handleAddItem}
              onUpdateStartedAt={handleUpdateStartedAt}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
