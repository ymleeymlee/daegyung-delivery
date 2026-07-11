'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { GopoumClient, GopoumItem, Client } from '@/types'

function todayStartIso() {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  return new Date(`${d}T00:00:00+09:00`).toISOString()
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}
function fmtYMD(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function GopoumCard({
  gc, items, todayStart, onDelete, onAddItem, onDeleteItem, onEditItem,
}: {
  gc: GopoumClient
  items: GopoumItem[]
  todayStart: string
  onDelete: (id: string) => void
  onAddItem: (clientId: string, description: string) => void
  onDeleteItem: (itemId: string) => void
  onEditItem: (itemId: string, updates: Partial<GopoumItem>, commit: boolean) => void
}) {
  const [showAddItem, setShowAddItem] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (showAddItem) inputRef.current?.focus() }, [showAddItem])

  const qty = (i: GopoumItem) => i.quantity ?? 1
  const collectedOf = (i: GopoumItem) => (i.collectors ?? []).reduce((s, c) => s + c.quantity, 0)
  const isDone = (i: GopoumItem) => collectedOf(i) > 0 && collectedOf(i) >= qty(i)
  const collectorNames = (i: GopoumItem): string[] | null => {
    const names = (i.collectors ?? []).map(c => `${c.rider_name}${c.quantity > 1 ? `(${c.quantity})` : ''}`)
    return names.length ? names : null
  }
  const lastPickedAt = (i: GopoumItem): string | null => {
    const ts = (i.collectors ?? []).map(c => c.picked_at).sort()
    return ts.length ? ts[ts.length - 1] : null
  }

  const sortedItems = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const total = items.reduce((s, i) => s + qty(i), 0)
  const collectedAll = items.reduce((s, i) => s + collectedOf(i), 0)
  const remaining = Math.max(0, total - collectedAll)
  const todayCollected = items.reduce((s, i) =>
    s + (i.collectors ?? []).filter(c => c.picked_at >= todayStart).reduce((a, c) => a + c.quantity, 0), 0)

  function submitItem() {
    if (!newDesc.trim()) return
    onAddItem(gc.id, newDesc.trim())
    setNewDesc('')
    setShowAddItem(false)
  }

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden text-sm ${remaining > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex min-h-14">
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
            sortedItems.map(item => (
              <div key={item.id} className={`flex items-center gap-2 px-4 py-2 group ${isDone(item) ? 'bg-green-50' : ''}`}>
                {/* 생성날짜 + 생성시간 */}
                <span className="w-16 flex-shrink-0 text-xs text-slate-400">{fmtYMD(item.created_at)}</span>
                <span className="w-12 flex-shrink-0 text-xs text-slate-400">{fmtTime(item.created_at)}</span>
                {/* 품목명 */}
                <span className={`w-28 flex-shrink-0 text-sm truncate ${isDone(item) ? 'text-green-700' : 'text-slate-700 font-medium'}`}>
                  {item.description}
                </span>
                {/* 수량 (−/직접입력/+) */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onClick={() => onEditItem(item.id, { quantity: Math.max(1, qty(item) - 1) }, true)}
                    className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none flex items-center justify-center">−</button>
                  <input
                    type="number" min={1} value={qty(item)}
                    onChange={e => onEditItem(item.id, { quantity: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }, false)}
                    onBlur={e => onEditItem(item.id, { quantity: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }, true)}
                    className="w-10 text-center text-sm border border-slate-200 rounded-md py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button type="button" onClick={() => onEditItem(item.id, { quantity: qty(item) + 1 }, true)}
                    className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 text-base leading-none flex items-center justify-center">+</button>
                </div>
                {/* 수거시간 (마지막 수거, 또는 -) */}
                <span className={`w-12 flex-shrink-0 text-sm ${collectedOf(item) > 0 ? 'text-slate-600' : 'text-slate-300'}`}>
                  {lastPickedAt(item) ? fmtTime(lastPickedAt(item)!) : '-'}
                </span>
                {/* 수거자 (완료 전까지 수거한 이름 누적, 또는 미수거) */}
                <span className={`w-28 flex-shrink-0 text-sm ${collectedOf(item) > 0 ? 'font-bold text-slate-800' : 'text-amber-500 font-medium'}`}>
                  {collectorNames(item)
                    ? collectorNames(item)!.map((n, idx) => <div key={idx} className="truncate leading-tight">{n}</div>)
                    : '미수거'}
                </span>
                {/* 수거량/총수량 */}
                <span className="w-14 flex-shrink-0 text-sm text-center whitespace-nowrap">
                  <span className={isDone(item) ? 'text-green-600 font-bold' : 'text-slate-600 font-semibold'}>{collectedOf(item)}</span>
                  <span className="text-slate-300">/{qty(item)}</span>
                </span>
                {/* 비고 (우측 정렬, 내용 입력) */}
                <input
                  value={item.note ?? ''}
                  onChange={e => onEditItem(item.id, { note: e.target.value }, false)}
                  onBlur={e => onEditItem(item.id, { note: e.target.value }, true)}
                  placeholder="비고"
                  className="flex-1 min-w-0 ml-auto text-right text-sm bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none px-1 py-0.5 placeholder:text-slate-300"
                />
                <button
                  onClick={() => { if (confirm(`'${item.description}' 품목을 삭제할까요?`)) onDeleteItem(item.id) }}
                  className="flex-shrink-0 text-slate-300 hover:text-red-400 text-lg leading-none px-1 transition-colors"
                  title="품목 삭제"
                >×</button>
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
  const [loading, setLoading] = useState(true)
  const suggBoxRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    const [{ data: gClients }, { data: gItems }] = await Promise.all([
      supabase.from('gopoum_clients').select('*').order('created_at', { ascending: true }),
      supabase.from('gopoum_items').select('*'),
    ])
    setGopoumClients(gClients ?? [])
    // 마감 안 된 아이템만 표시 (미수거 + 오늘 수거했지만 아직 마감 전)
    const allItems = gItems ?? []
    setGopoumItems(allItems.filter(i => !i.archived_at))
  }, [])

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
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
    // 낙관적 업데이트: DB 응답 전에 화면 먼저 반영
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempItem: GopoumItem = { id: tempId, gopoum_client_id: clientId, description, quantity: 1, note: null, collectors: [], rider_name: null, delivery_id: null, picked_at: null, created_at: now, archived_at: null }
    setGopoumItems(prev => [...prev, tempItem])

    const res = await fetch('/api/gopoum-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gopoum_client_id: clientId, description }),
    })
    const json = await res.json()
    if (!res.ok) {
      setGopoumItems(prev => prev.filter(i => i.id !== tempId))
      alert('추가 실패: ' + json.error)
      return
    }
    setGopoumItems(prev => prev.map(i => i.id === tempId ? json : i))
  }

  async function handleDelete(id: string) {
    setGopoumClients(prev => prev.filter(gc => gc.id !== id))
    setGopoumItems(prev => prev.filter(i => i.gopoum_client_id !== id))
    const { error } = await supabase.from('gopoum_clients').delete().eq('id', id)
    if (error) fetchData()

  }

  async function handleDeleteItem(itemId: string) {
    setGopoumItems(prev => prev.filter(i => i.id !== itemId))
    const res = await fetch('/api/gopoum-items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId }),
    })
    if (!res.ok) fetchData()

  }

  // 수량/비고 편집: 입력 중(commit=false)엔 화면만, 확정(commit=true)엔 DB에도 저장
  function handleEditItem(itemId: string, updates: Partial<GopoumItem>, commit: boolean) {
    setGopoumItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i))
    if (!commit) return
    fetch('/api/gopoum-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, ...updates }),
    }).then(res => { if (!res.ok) fetchData() })
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
            <div className="w-20 flex-shrink-0 pl-2">업체번호</div>
            <div className="w-40 flex-shrink-0 pl-2">업체명</div>
            <div className="w-32 flex-shrink-0 text-center">찾아온/총수량</div>
            <div className="flex-1 pl-4">품목 (생성시간 · 품목명 · 수량 · 수거시간 · 수거자 · 수거량/총 · 비고)</div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {loading ? (
            <div className="text-center text-slate-400 text-sm py-16">불러오는 중...</div>
          ) : gopoumClients.length === 0 && (
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
              onDeleteItem={handleDeleteItem}
              onEditItem={handleEditItem}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
