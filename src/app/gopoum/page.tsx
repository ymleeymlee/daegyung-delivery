'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { GopoumClient, GopoumItem, Client } from '@/types'
import { useBranch } from '@/lib/branch'

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
  gc, items, todayStart, onDeleteItem, onEditItem,
}: {
  gc: GopoumClient
  items: GopoumItem[]
  todayStart: string
  onDeleteItem: (itemId: string) => void
  onEditItem: (itemId: string, updates: Partial<GopoumItem>, commit: boolean) => void
}) {
  const qty = (i: GopoumItem) => i.quantity ?? 1
  const collectedOf = (i: GopoumItem) => (i.collectors ?? []).reduce((s, c) => s + c.quantity, 0)
  const isDone = (i: GopoumItem) => collectedOf(i) > 0 && collectedOf(i) >= qty(i)
  // 수거자별 한 줄씩 + 잔여가 있으면 마지막에 '미수거' 줄 추가.
  // { 이름, 수량, 수거날짜, 수거시각, collected } — 수거날짜·시간·수거자·수거량 열을 같은 순서로 줄맞춤
  const collectorLines = (i: GopoumItem) => {
    const lines = (i.collectors ?? []).map(c => ({
      name: c.rider_name,
      count: c.quantity,
      date: fmtYMD(c.picked_at),
      time: fmtTime(c.picked_at),
      collected: true,
    }))
    const rem = qty(i) - collectedOf(i)
    if (rem > 0) lines.push({ name: '미수거', count: rem, date: '', time: '', collected: false })
    return lines
  }

  const sortedItems = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const total = items.reduce((s, i) => s + qty(i), 0)
  const collectedAll = items.reduce((s, i) => s + collectedOf(i), 0)
  const remaining = Math.max(0, total - collectedAll)
  const todayCollected = items.reduce((s, i) =>
    s + (i.collectors ?? []).filter(c => c.picked_at >= todayStart).reduce((a, c) => a + c.quantity, 0), 0)

  return (
    <div className={`bg-white rounded-2xl shadow-sm border overflow-hidden text-sm ${remaining > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
      <div className="flex min-h-14">
        {/* 수거 현황 */}
        <div className="w-24 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-center items-center gap-1">
          <div className="flex items-baseline gap-0.5">
            <span className={`text-base font-bold ${remaining > 0 ? 'text-amber-600' : 'text-green-600'}`}>{todayCollected}</span>
            <span className="text-slate-300 text-xs mx-0.5">/</span>
            <span className="text-sm font-bold text-slate-700">{total}</span>
          </div>
          <span className={`text-xs ${remaining > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
            {remaining > 0 ? `잔여 ${remaining}개` : total > 0 ? '완료' : '없음'}
          </span>
        </div>

        {/* 업체번호 (최대 4자) */}
        <div className="w-12 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-start">
          <span className="text-xs text-slate-500">{gc.client_code || '-'}</span>
        </div>

        {/* 업체명 (2줄까지 표시) */}
        <div className="w-24 flex-shrink-0 border-r border-slate-100 p-2 flex flex-col justify-start">
          <span className="text-sm font-medium text-slate-700 leading-tight line-clamp-2 break-all">{gc.client_name}</span>
        </div>

        {/* 아이템 목록 */}
        <div className="flex-1 min-w-0 divide-y divide-slate-400">
          {items.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-300 italic flex items-center h-full">품목 없음</div>
          ) : (
            sortedItems.map(item => {
              const isToday = item.created_at >= todayStart
              const rowBg = isDone(item) ? 'bg-green-50' : isToday ? 'bg-emerald-50/60' : ''
              return (
              <div key={item.id} className={`flex items-center gap-2 px-4 py-2 group ${rowBg}`}>
                {/* 생성날짜 + 생성시간 */}
                <span className="w-16 flex-shrink-0 text-xs text-slate-400">{fmtYMD(item.created_at)}</span>
                <span className="w-12 flex-shrink-0 text-xs text-slate-400">{fmtTime(item.created_at)}</span>
                {/* 품목명 */}
                <span className={`w-20 flex-shrink-0 text-sm truncate ${isDone(item) ? 'text-green-700' : 'text-slate-700 font-medium'}`}>
                  {item.description}
                </span>
                {/* 차종 */}
                <span className={`w-20 flex-shrink-0 text-sm truncate ${item.car_type ? 'text-slate-700 font-medium' : 'text-slate-300 italic'}`}>
                  {item.car_type || '차종모름'}
                </span>
                {/* 수량 (직접입력) */}
                <input
                  type="number" min={1} value={qty(item)}
                  onChange={e => onEditItem(item.id, { quantity: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }, false)}
                  onBlur={e => onEditItem(item.id, { quantity: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }, true)}
                  className="w-10 flex-shrink-0 text-center text-sm border border-slate-200 rounded-md py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {/* 수거날짜 (수거자별 한 줄씩, 또는 -) — 빈 줄도 공백(nbsp)으로 채워 옆 열과 줄맞춤 */}
                <span className={`w-16 flex-shrink-0 text-xs ${collectedOf(item) > 0 ? 'text-slate-500' : 'text-slate-300'}`}>
                  {collectorLines(item).length
                    ? collectorLines(item).map((l, idx) => <div key={idx} className="leading-5">{l.date || ' '}</div>)
                    : <div className="leading-5">-</div>}
                </span>
                {/* 수거시간 (수거자별 한 줄씩, 또는 -) */}
                <span className={`w-12 flex-shrink-0 text-sm ${collectedOf(item) > 0 ? 'text-slate-600' : 'text-slate-300'}`}>
                  {collectorLines(item).length
                    ? collectorLines(item).map((l, idx) => <div key={idx} className="leading-5">{l.time || ' '}</div>)
                    : <div className="leading-5">-</div>}
                </span>
                {/* 수거자 (수거자별 + 미수거 잔여 한 줄씩) */}
                <span className="w-24 flex-shrink-0 text-sm">
                  {collectorLines(item).length
                    ? collectorLines(item).map((l, idx) => (
                        <div key={idx} className={`truncate leading-5 ${l.collected ? 'font-bold text-slate-800' : 'text-amber-500 font-medium'}`}>{l.name}</div>
                      ))
                    : <div className="leading-5">미수거</div>}
                </span>
                {/* 수거량 (수거자별 한 줄씩) */}
                <span className="w-10 flex-shrink-0 text-sm text-center">
                  {collectorLines(item).map((l, idx) => (
                    <div key={idx} className={`leading-5 ${l.collected ? 'font-bold text-slate-800' : 'text-amber-500 font-medium'}`}>{l.count}</div>
                  ))}
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
              )
            })
          )}
        </div>

      </div>

    </div>
  )
}

export default function GopoumPage() {
  const { branch } = useBranch()
  const [gopoumClients, setGopoumClients] = useState<GopoumClient[]>([])
  const [gopoumItems, setGopoumItems] = useState<GopoumItem[]>([])
  const [todayStart] = useState(todayStartIso)

  const [inputClient, setInputClient] = useState('') // 사용자에게 보이는 입력값(업체번호 또는 업체명)
  const [pickedCode, setPickedCode] = useState('') // 자동완성 선택 시 저장된 업체번호. 사용자가 다시 타이핑하면 초기화
  const [inputDesc, setInputDesc] = useState('')
  const [inputCarType, setInputCarType] = useState('')
  const [inputQty, setInputQty] = useState('1')
  const [inputNote, setInputNote] = useState('')
  const [suggestions, setSuggestions] = useState<Client[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const suggBoxRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = useCallback(async () => {
    const [{ data: gClients }, { data: gItems }] = await Promise.all([
      supabase.from('gopoum_clients').select('*').eq('branch', branch),
      supabase.from('gopoum_items').select('*'),
    ])
    // 업체번호(client_code) 오름차순 정렬. 빈 코드는 뒤로.
    const sortedClients = [...(gClients ?? [])].sort((a, b) => {
      const ca = (a.client_code || '').trim()
      const cb = (b.client_code || '').trim()
      if (!ca && !cb) return a.created_at.localeCompare(b.created_at)
      if (!ca) return 1
      if (!cb) return -1
      return ca.localeCompare(cb, 'ko', { numeric: true })
    })
    setGopoumClients(sortedClients)
    // 마감 안 된 아이템만 표시 (미수거 + 오늘 수거했지만 아직 마감 전)
    const allItems = gItems ?? []
    setGopoumItems(allItems.filter(i => !i.archived_at))
  }, [branch])

  // 실시간 재조회 디바운스: 수량 +/- 연타 시 오래된 서버 응답이 낙관적 값을 덮어써 숫자가 튀는 현상 방지
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedFetch = useCallback(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current)
    fetchTimer.current = setTimeout(() => { fetchData() }, 500)
  }, [fetchData])

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
    const channel = supabase
      .channel('gopoum-page-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_clients' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_items' }, debouncedFetch)
      .subscribe()
    return () => { if (fetchTimer.current) clearTimeout(fetchTimer.current); supabase.removeChannel(channel) }
  }, [fetchData, debouncedFetch])

  useEffect(() => {
    const term = inputClient.trim()
    if (!term) { setSuggestions([]); setShowSugg(false); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('clients').select('*').eq('branch', branch).or(`code.ilike.%${term}%,name.ilike.%${term}%`).limit(6)
      setSuggestions(data ?? [])
      setShowSugg((data ?? []).length > 0)
    }, 180)
    return () => clearTimeout(timer)
  }, [inputClient, branch])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (suggBoxRef.current && !suggBoxRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleAdd() {
    if (!inputClient.trim() || !inputDesc.trim() || adding) return
    setAdding(true)
    const name = inputClient.trim()
    const code = pickedCode.trim()
    const desc = inputDesc.trim()
    const carType = inputCarType.trim() || null
    const qty = Math.max(1, parseInt(inputQty || '1', 10) || 1)
    const note = inputNote.trim() || null
    // 동일 지점+업체번호+업체명 조합의 gopoum_client 재사용, 없으면 신규 생성.
    let clientId: string | null = gopoumClients.find(gc =>
      gc.branch === branch && (gc.client_code || '') === code && gc.client_name === name
    )?.id ?? null
    if (!clientId) {
      const { data, error } = await supabase.from('gopoum_clients').insert({
        client_id: null, client_code: code, client_name: name,
        total_quantity: 0, started_at: null, branch,
      }).select('id').single()
      if (error || !data) { setAdding(false); alert('업체 추가 실패: ' + (error?.message ?? '')); return }
      clientId = data.id
    }
    await handleAddItem(clientId!, desc, carType, qty, note)
    setAdding(false)
    setInputClient(''); setPickedCode(''); setInputDesc(''); setInputCarType(''); setInputQty('1'); setInputNote('')
    setSuggestions([]); setShowSugg(false)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportStatus('파싱 중...')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

      // 헤더 공백 제거 후 매칭 (예: '거 래 처 명' → '거래처명')
      const pick = (row: Record<string, unknown>, key: string) => {
        const found = Object.keys(row).find(k => k.replace(/\s/g, '') === key)
        return found != null ? String(row[found] ?? '').trim() : ''
      }
      const parsed = rows.map(r => ({
        code: pick(r, '업체번호'),
        name: pick(r, '거래처명'),
        desc: pick(r, '품목'),
        carType: pick(r, '차종'),
        qtyStr: pick(r, '수량'),
        note: pick(r, '비고'),
      })).filter(r => r.name && r.desc)

      if (parsed.length === 0) { setImportStatus('유효 행 없음'); return }

      // 기존 gopoum_clients 매핑 (지점+코드+이름 조합)
      const clientMap = new Map<string, string>()
      for (const gc of gopoumClients) {
        clientMap.set(`${(gc.client_code || '').trim()}|${gc.client_name}`, gc.id)
      }
      // 파일에 있으나 아직 없는 업체만 신규 생성
      const missing = new Map<string, { code: string; name: string }>()
      for (const r of parsed) {
        const key = `${r.code}|${r.name}`
        if (!clientMap.has(key) && !missing.has(key)) missing.set(key, { code: r.code, name: r.name })
      }
      if (missing.size > 0) {
        setImportStatus(`업체 ${missing.size}개 등록 중...`)
        const toInsert = [...missing.values()].map(c => ({
          client_id: null, client_code: c.code, client_name: c.name,
          total_quantity: 0, started_at: null, branch,
        }))
        const { data: newClients, error } = await supabase.from('gopoum_clients').insert(toInsert)
          .select('id, client_code, client_name')
        if (error) throw error
        for (const nc of newClients ?? []) {
          clientMap.set(`${(nc.client_code || '').trim()}|${nc.client_name}`, nc.id)
        }
      }

      // 품목 일괄 insert (항상 새 행)
      const items = parsed.map(r => {
        const clientId = clientMap.get(`${r.code}|${r.name}`)
        const qty = Math.max(1, parseInt(r.qtyStr || '1', 10) || 1)
        return {
          gopoum_client_id: clientId!,
          description: r.desc,
          car_type: r.carType || null,
          quantity: qty,
          note: r.note || null,
        }
      }).filter(x => x.gopoum_client_id)
      setImportStatus(`품목 ${items.length}건 등록 중...`)
      const { error: itemErr } = await supabase.from('gopoum_items').insert(items)
      if (itemErr) throw itemErr

      setImportStatus(`${items.length}건 가져옴 (신규 업체 ${missing.size}개)`)
      fetchData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setImportStatus('가져오기 실패')
      alert('가져오기 실패: ' + msg)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => setImportStatus(''), 4000)
    }
  }

  async function handleAddItem(clientId: string, description: string, carType: string | null = null, quantity: number = 1, note: string | null = null) {
    // 낙관적 업데이트: DB 응답 전에 화면 먼저 반영
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempItem: GopoumItem = { id: tempId, gopoum_client_id: clientId, description, car_type: carType, quantity, note, collectors: [], rider_name: null, delivery_id: null, picked_at: null, created_at: now, archived_at: null }
    setGopoumItems(prev => [...prev, tempItem])

    const res = await fetch('/api/gopoum-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gopoum_client_id: clientId, description, car_type: carType, quantity, note }),
    })
    const json = await res.json()
    if (!res.ok) {
      setGopoumItems(prev => prev.filter(i => i.id !== tempId))
      alert('추가 실패: ' + json.error)
      return
    }
    setGopoumItems(prev => prev.map(i => i.id === tempId ? json : i))
  }

  async function handleDeleteItem(itemId: string) {
    const item = gopoumItems.find(i => i.id === itemId)
    setGopoumItems(prev => prev.filter(i => i.id !== itemId))
    const res = await fetch('/api/gopoum-items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId }),
    })
    if (!res.ok) { fetchData(); return }

    // 이 업체의 다른 활성 품목이 하나도 없으면, 아카이브 이력도 없는지 확인 후 업체 삭제.
    // 아카이브가 있으면 CASCADE 로 기록이 함께 사라지므로 DB 는 그대로 두고 UI 에서만 자연 노출 안 됨.
    if (!item) return
    const clientId = item.gopoum_client_id
    const remainingActive = gopoumItems.filter(i => i.gopoum_client_id === clientId && i.id !== itemId).length
    if (remainingActive > 0) return
    const { count } = await supabase.from('gopoum_items')
      .select('id', { count: 'exact', head: true })
      .eq('gopoum_client_id', clientId)
    if ((count ?? 0) === 0) {
      await supabase.from('gopoum_clients').delete().eq('id', clientId)
      setGopoumClients(prev => prev.filter(gc => gc.id !== clientId))
    }
  }

  // 수량/비고 편집: 입력 중(commit=false)엔 화면만, 확정(commit=true)엔 DB에도 저장
  function handleEditItem(itemId: string, updates: Partial<GopoumItem>, commit: boolean) {
    // 수량 변경 시 완전수거 여부(picked_at) 재계산.
    // 수량을 올려 미완료가 되면 picked_at을 비워 배송카드·마감 로직이 다시 미수거로 인식하게 함.
    if (typeof updates.quantity === 'number') {
      const item = gopoumItems.find(i => i.id === itemId)
      if (item) {
        const collected = (item.collectors ?? []).reduce((s, c) => s + c.quantity, 0)
        const fullyCollected = collected > 0 && collected >= updates.quantity
        updates = { ...updates, picked_at: fullyCollected ? (item.picked_at ?? new Date().toISOString()) : null }
      }
    }
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
      {/* 업체·품목 통합 추가 폼 */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0" ref={suggBoxRef}>
        <div className="flex items-center gap-2 flex-wrap relative">
          <div className="relative">
            <input value={inputClient}
              onChange={e => { setInputClient(e.target.value); setPickedCode('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !showSugg) handleAdd() }}
              placeholder="업체번호 또는 업체명" className={`${inputCls} w-56`} />
            {pickedCode && (
              <span className="absolute -top-2 left-2 text-[10px] font-mono text-slate-500 bg-white px-1">코드 {pickedCode}</span>
            )}
            {showSugg && suggestions.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
                {suggestions.map(c => (
                  <button key={c.id} type="button"
                    onClick={() => { setInputClient(c.name); setPickedCode(c.code || ''); setShowSugg(false) }}
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
          <input value={inputDesc} onChange={e => setInputDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !showSugg) handleAdd() }}
            placeholder="품목명 (필수)" className={`${inputCls} w-40`} />
          <input value={inputCarType} onChange={e => setInputCarType(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !showSugg) handleAdd() }}
            placeholder="차종 (선택)" className={`${inputCls} w-28`} />
          <input type="number" min={1} value={inputQty}
            onChange={e => setInputQty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !showSugg) handleAdd() }}
            placeholder="수량" className={`${inputCls} w-16 text-center`} />
          <input value={inputNote} onChange={e => setInputNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !showSugg) handleAdd() }}
            placeholder="비고" className={`${inputCls} w-36`} />
          <button onClick={handleAdd} disabled={!inputClient.trim() || !inputDesc.trim() || adding}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40 whitespace-nowrap">
            {adding ? '추가 중...' : '+ 추가'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {importStatus && <span className="text-xs text-slate-500">{importStatus}</span>}
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
            <button onClick={() => fileInputRef.current?.click()} disabled={importing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40 whitespace-nowrap">
              {importing ? '가져오는 중...' : '📥 가져오기'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {gopoumClients.length > 0 && (
          <div className="flex text-xs text-slate-400 font-semibold mb-1.5 px-1">
            <div className="w-24 flex-shrink-0 text-center">찾아온/총수량</div>
            <div className="w-12 flex-shrink-0 pl-2">번호</div>
            <div className="w-24 flex-shrink-0 pl-2">업체명</div>
            <div className="flex-1 pl-4">품목 (생성시간 · 품목명 · 차종 · 수량 · 수거날짜 · 수거시간 · 수거자 · 수거량 · 비고)</div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {loading ? (
            <div className="text-center text-slate-400 text-sm py-16">불러오는 중...</div>
          ) : gopoumClients.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-16">등록된 고품 업체가 없습니다.</div>
          )}
          {gopoumClients
            .filter(gc => gopoumItems.some(i => i.gopoum_client_id === gc.id))
            .map(gc => (
              <GopoumCard
                key={gc.id}
                gc={gc}
                items={gopoumItems.filter(i => i.gopoum_client_id === gc.id)}
                todayStart={todayStart}
                onDeleteItem={handleDeleteItem}
                onEditItem={handleEditItem}
              />
            ))}
        </div>
      </div>
    </div>
  )
}
