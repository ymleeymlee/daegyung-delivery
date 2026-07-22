'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Delivery, Rider, GopoumClient, GopoumItem } from '@/types'
import DeliveryCard from './DeliveryCard'
import QuickAddBar from './QuickAddBar'
import RiderAddModal from './RiderAddModal'
import { AppState, fetchAppState, isClosedNow } from '@/lib/appState'

function RiderSection({
  rider, deliveries, selectedIds, onRiderClick, onSelect, onDelete,
  getGopoumData, onSetPickup, onAddToRider,
}: {
  rider: Rider
  deliveries: Delivery[]
  selectedIds: string[]
  onRiderClick: (riderId: string, e: React.MouseEvent) => void
  onSelect: (delivery: Delivery) => void
  onDelete: (d: Delivery) => void
  getGopoumData: (d: Delivery) => { clientId: string; items: GopoumItem[] } | null
  onSetPickup: (itemId: string, deliveryId: string, riderName: string, quantity: number) => void
  onAddToRider: (riderId: string, clientName: string, clientAddress: string, clientId?: string) => void
}) {
  const isClickable = selectedIds.length > 0
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div
      onClick={(e) => onRiderClick(rider.id, e)}
      className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 min-w-56 flex-shrink-0 transition-colors ${isClickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30' : ''}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-sm font-semibold transition-colors ${isClickable ? 'text-blue-700' : 'text-slate-700'}`}>{rider.name}</span>
        {rider.phone && <span className="text-xs text-slate-400 font-medium">{rider.phone}</span>}
        <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{deliveries.length}</span>
      </div>

      <div className="min-h-20 flex flex-col gap-2">
        {deliveries.length === 0 && <p className="text-xs text-slate-300 italic text-center py-4">배송 없음</p>}
        {deliveries.map(d => {
          const gd = getGopoumData(d)
          return (
            <DeliveryCard
              key={d.id}
              delivery={d}
              isSelected={selectedIds.includes(d.id)}
              hasSelection={selectedIds.length > 0}
              onSelect={onSelect}
              onDelete={onDelete}
              gopoumItems={gd?.items}
              gopoumClientId={gd?.clientId}
              riderName={rider.name}
              onSetPickup={onSetPickup}
            />
          )
        })}
      </div>

      {/* 이 라이더에 바로 추가 (업체번호 검색 팝업) */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowAdd(true) }}
        className="mt-2 w-full py-1.5 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-blue-300 hover:text-blue-500 text-sm font-medium transition-colors"
      >+ 추가</button>
      {showAdd && (
        <RiderAddModal
          riderName={rider.name}
          onPick={(name, address, clientId) => onAddToRider(rider.id, name, address, clientId)}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

export default function DeliveryBoard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [riders, setRiders] = useState<Rider[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [gopoumClients, setGopoumClients] = useState<GopoumClient[]>([])
  const [gopoumItems, setGopoumItems] = useState<GopoumItem[]>([])
  const [codeById, setCodeById] = useState<Map<string, string>>(new Map())
  // 거래처 id → 좌표 (배송 생성 시 dest_lat/lng 로 복사 → 앱 자동 도착감지)
  const [coordById, setCoordById] = useState<Map<string, { lat: number; lng: number }>>(new Map())
  const [appState, setAppState] = useState<AppState>({ offset: 0, closedUntil: null })
  const [loading, setLoading] = useState(true)
  const [queueOpen, setQueueOpen] = useState(false)   // 대기열 접기: 기본 숨김

  const fetchAll = useCallback(async () => {
    const [{ data: d }, { data: r }, { data: c }] = await Promise.all([
      // completed 포함 — 완료 카드도 보드에 '완료'로 계속 표시(마감 때까지 유지·기록). waiting/assigned/completed 전부.
      supabase.from('deliveries').select('*').order('sort_order'),
      supabase.from('riders').select('*').eq('is_active', true).order('created_at'),
      supabase.from('clients').select('id, code, lat, lng'),
    ])
    setDeliveries(d ?? [])
    setRiders(r ?? [])
    // 거래처 id → 업체번호 매핑 (고품 매칭용) + 좌표 매핑 (배송 도착감지용)
    const map = new Map<string, string>()
    const coords = new Map<string, { lat: number; lng: number }>()
    for (const cl of (c ?? []) as { id: string; code: string | null; lat: number | null; lng: number | null }[]) {
      if (cl.code?.trim()) map.set(cl.id, cl.code.trim())
      if (cl.lat != null && cl.lng != null) coords.set(cl.id, { lat: cl.lat, lng: cl.lng })
    }
    setCodeById(map)
    setCoordById(coords)
  }, [])

  const fetchGopoum = useCallback(async () => {
    const [{ data: gClients }, { data: gItems }] = await Promise.all([
      supabase.from('gopoum_clients').select('*'),
      supabase.from('gopoum_items').select('*'),
    ])
    setGopoumClients(gClients ?? [])
    const allItems = gItems ?? []
    // 마감 안 된 아이템만
    setGopoumItems(allItems.filter((i: { archived_at: string | null }) => !i.archived_at))
  }, [])

  const refreshAppState = useCallback(async () => { setAppState(await fetchAppState()) }, [])

  // realtime 재조회 debounce: 빠른 연속 수거 시 중간 상태로 낙관적 업데이트가 덮이는 것 방지
  const gopoumTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedFetchGopoum = useCallback(() => {
    if (gopoumTimer.current) clearTimeout(gopoumTimer.current)
    gopoumTimer.current = setTimeout(fetchGopoum, 500)
  }, [fetchGopoum])

  useEffect(() => {
    Promise.all([fetchAll(), fetchGopoum(), refreshAppState()]).finally(() => setLoading(false))
    const channel = supabase
      .channel('board-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_clients' }, debouncedFetchGopoum)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_items' }, debouncedFetchGopoum)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, refreshAppState)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAll, fetchGopoum, debouncedFetchGopoum, refreshAppState])

  const gopoumMap = useMemo(() => {
    // 업체번호(코드) 기준으로 고품 품목을 묶음. 코드 없으면 상호명 폴백.
    const byCode = new Map<string, GopoumItem[]>()
    const byName = new Map<string, GopoumItem[]>()
    for (const gc of gopoumClients) {
      const items = gopoumItems.filter(i => i.gopoum_client_id === gc.id)
      const code = (gc.client_code ?? '').trim()
      if (code) {
        if (!byCode.has(code)) byCode.set(code, [])
        byCode.get(code)!.push(...items)
      }
      if (!byName.has(gc.client_name)) byName.set(gc.client_name, [])
      byName.get(gc.client_name)!.push(...items)
    }
    return { byCode, byName }
  }, [gopoumClients, gopoumItems])

  function getGopoumData(d: Delivery) {
    // 1) 업체번호 매칭 (배송 카드의 대표 거래처 → 코드 → 고품)
    const code = d.client_id ? codeById.get(d.client_id) : undefined
    let items: GopoumItem[] | null = null
    if (code && gopoumMap.byCode.has(code)) {
      items = gopoumMap.byCode.get(code)!
    } else if (gopoumMap.byName.has(d.client_name)) {
      // 2) 폴백: 상호명 정확 매칭
      items = gopoumMap.byName.get(d.client_name)!
    }
    if (!items) return null
    // 카드 생성 당시 기준 스냅샷: 생성 시점에 존재하던 품목만.
    // (이후 추가된 품목은 이 카드에 소급되지 않음)
    const createdCut = d.created_at
    const snapshot = items.filter(i => i.created_at <= createdCut)
    return { clientId: '', items: snapshot }
  }

  function handleAdd(clientName: string, clientAddress: string, clientId?: string) {
    if (isClosedNow(appState)) { alert('마감된 상태입니다. 배송을 추가할 수 없습니다.'); return }
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.status === 'waiting').map(d => d.sort_order))
    const now = new Date().toISOString()
    const coord = clientId ? coordById.get(clientId) : undefined
    const row: Delivery = {
      id: crypto.randomUUID(), client_id: clientId ?? null, client_name: clientName,
      client_address: clientAddress, status: 'waiting', created_at: now,
      assigned_at: null, rider_id: null, sort_order: maxOrder + 1,
      dest_lat: coord?.lat ?? null, dest_lng: coord?.lng ?? null,
    }
    setDeliveries(prev => [...prev, row])
    supabase.from('deliveries').insert(row).then(({ error }) => { if (error) fetchAll() })
  }

  // 이름블럭 아래 + 버튼: 선택한 업체를 해당 라이더에 바로 배정 상태로 추가
  function handleAddToRider(riderId: string, clientName: string, clientAddress: string, clientId?: string) {
    if (isClosedNow(appState)) { alert('마감된 상태입니다. 배송을 추가할 수 없습니다.'); return }
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.rider_id === riderId && d.status === 'assigned').map(d => d.sort_order))
    const now = new Date().toISOString()
    const coord = clientId ? coordById.get(clientId) : undefined
    const row: Delivery = {
      id: crypto.randomUUID(), client_id: clientId ?? null, client_name: clientName,
      client_address: clientAddress, status: 'assigned', created_at: now,
      assigned_at: now, rider_id: riderId, sort_order: maxOrder + 1,
      dest_lat: coord?.lat ?? null, dest_lng: coord?.lng ?? null,
    }
    setDeliveries(prev => [...prev, row])
    supabase.from('deliveries').insert(row).then(({ error }) => { if (error) fetchAll() })
  }

  function handleDelete(delivery: Delivery) {
    setSelectedIds(prev => prev.filter(id => id !== delivery.id))
    setDeliveries(prev => prev.filter(d => d.id !== delivery.id))
    setGopoumItems(prev => prev.filter(i => i.delivery_id !== delivery.id))
    supabase.from('deliveries').delete().eq('id', delivery.id).then(({ error }) => { if (error) fetchAll() })
  }

  // 이 배송(라이더)의 수거량을 myQty로 설정. collectors 배열을 갱신하고 완전수거면 picked_at 기록.
  function handleSetPickup(itemId: string, deliveryId: string, riderName: string, myQty: number) {
    const item = gopoumItems.find(i => i.id === itemId)
    if (!item) return
    const now = new Date().toISOString()
    const others = (item.collectors ?? []).filter(c => c.delivery_id !== deliveryId)
    const next = myQty > 0
      ? [...others, { delivery_id: deliveryId, rider_name: riderName, quantity: myQty, picked_at: now }]
      : others
    const collectedTotal = next.reduce((s, c) => s + c.quantity, 0)
    const patch = {
      collectors: next,
      rider_name: next.length ? next.map(c => c.rider_name).join(', ') : null,
      delivery_id: null,
      picked_at: collectedTotal > 0 && collectedTotal >= (item.quantity ?? 1) ? now : null,
    }
    setGopoumItems(prev => prev.map(i => i.id === itemId ? { ...i, ...patch } : i))
    fetch('/api/gopoum-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, ...patch }),
    }).then(res => { if (!res.ok) fetchGopoum() })
  }

  // 카드 클릭
  function handleCardClick(clicked: Delivery) {
    if (clicked.status === 'waiting') {
      // 대기열 카드: 다중 선택 토글
      setSelectedIds(prev =>
        prev.includes(clicked.id) ? prev.filter(id => id !== clicked.id) : [...prev, clicked.id]
      )
      return
    }
    // 이름 블럭 안(배정된) 카드: 선택에 넣지 않음.
    // 대기열에서 선택한 카드가 있으면, 이 카드가 속한 라이더에게 일괄 배정.
    if (selectedIds.length > 0 && clicked.rider_id) assignSelectedToRider(clicked.rider_id)
  }

  // 선택된 카드들을 클릭 순서대로 한 라이더에 일괄 배정
  function assignSelectedToRider(riderId: string) {
    if (selectedIds.length === 0) return
    const targets = selectedIds
      .map(id => deliveries.find(d => d.id === id))
      .filter((d): d is Delivery => !!d && !(d.rider_id === riderId && d.status === 'assigned'))
    if (targets.length === 0) { setSelectedIds([]); return }
    const now = new Date().toISOString()
    const base = Math.max(0, ...deliveries.filter(d => d.rider_id === riderId && d.status === 'assigned').map(d => d.sort_order))
    const orderMap = new Map(targets.map((d, i) => [d.id, base + i + 1]))
    setDeliveries(prev => prev.map(d => orderMap.has(d.id)
      ? { ...d, rider_id: riderId, status: 'assigned', assigned_at: now, sort_order: orderMap.get(d.id)! } : d))
    for (const d of targets) {
      supabase.from('deliveries')
        .update({ rider_id: riderId, status: 'assigned', assigned_at: now, sort_order: orderMap.get(d.id)! })
        .eq('id', d.id).then(({ error }) => { if (error) fetchAll() })
    }
    setSelectedIds([])
  }

  // 선택된 카드들을 대기열로 일괄 복귀
  function requeueSelected() {
    if (selectedIds.length === 0) return
    const targets = selectedIds
      .map(id => deliveries.find(d => d.id === id))
      .filter((d): d is Delivery => !!d && d.status !== 'waiting')
    if (targets.length === 0) { setSelectedIds([]); return }
    const base = Math.max(0, ...deliveries.filter(d => d.status === 'waiting').map(d => d.sort_order))
    const orderMap = new Map(targets.map((d, i) => [d.id, base + i + 1]))
    setDeliveries(prev => prev.map(d => orderMap.has(d.id)
      ? { ...d, rider_id: null, status: 'waiting', assigned_at: null, sort_order: orderMap.get(d.id)! } : d))
    for (const d of targets) {
      supabase.from('deliveries')
        .update({ rider_id: null, status: 'waiting', assigned_at: null, sort_order: orderMap.get(d.id)! })
        .eq('id', d.id).then(({ error }) => { if (error) fetchAll() })
    }
    setSelectedIds([])
  }

  function handleRiderClick(riderId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (selectedIds.length === 0) return
    assignSelectedToRider(riderId)
  }

  function handleWaitingZoneClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (selectedIds.length === 0) return
    requeueSelected()
  }

  const waitingDeliveries = deliveries.filter(d => d.status === 'waiting').sort((a, b) => a.sort_order - b.sort_order)
  const regularRiders = riders.filter(r => !r.is_quick)
  const quickRiders = riders.filter(r => r.is_quick)

  function getRiderDeliveries(riderId: string) {
    // 배정 + 완료 모두 표시. 쌓인 순서(sort_order = 생성 순) 그대로 —
    // 완료돼도 위치를 아래로 밀지 않고 제자리 유지(생성 순서 보존).
    return deliveries
      .filter(d => d.rider_id === riderId && (d.status === 'assigned' || d.status === 'completed'))
      .sort((a, b) => a.sort_order - b.sort_order)
  }

  const cardProps = {
    selectedIds,
    onRiderClick: handleRiderClick,
    onSelect: handleCardClick,
    onDelete: handleDelete,
    getGopoumData,
    onSetPickup: handleSetPickup,
    onAddToRider: handleAddToRider,
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-sm">불러오는 중...</div>
  }

  return (
    <div className="p-4 flex flex-col gap-4 min-h-[calc(100vh-56px)]" onClick={() => setSelectedIds([])}>
      {/* 대기열 */}
      <section onClick={handleWaitingZoneClick} className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 transition-colors ${selectedIds.length > 0 ? 'cursor-pointer hover:border-amber-300 hover:bg-amber-50/30' : ''}`}>
        <div className={`flex items-center justify-between gap-3 flex-wrap ${queueOpen ? 'mb-3' : ''}`} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setQueueOpen(o => !o)}
            className="flex items-center gap-2 rounded-lg px-1 -mx-1 hover:bg-slate-50 transition-colors"
          >
            <span className={`text-slate-400 text-xs transition-transform ${queueOpen ? 'rotate-90' : ''}`}>▶</span>
            <span className="text-sm font-semibold text-slate-700">대기열</span>
            <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{waitingDeliveries.length}</span>
          </button>
          <QuickAddBar onAdd={(name, address, clientId) => { setQueueOpen(true); handleAdd(name, address, clientId) }} />
        </div>
        {queueOpen && (
          <div className="min-h-16 flex gap-3 flex-wrap">
            {waitingDeliveries.length === 0 && <p className="text-sm text-slate-300 italic self-center">배송 카드를 추가하세요</p>}
            {waitingDeliveries.map(d => {
              const gd = getGopoumData(d)
              return (
                <DeliveryCard
                  key={d.id} delivery={d}
                  isSelected={selectedIds.includes(d.id)}
                  hasSelection={selectedIds.length > 0}
                  onSelect={handleCardClick} onDelete={handleDelete}
                  gopoumItems={gd?.items} gopoumClientId={gd?.clientId}
                  onSetPickup={handleSetPickup}
                />
              )
            })}
          </div>
        )}
      </section>

      {/* 라이더 구역 */}
      <section className="flex gap-4 overflow-x-auto pb-2 items-start">
        {regularRiders.map(rider => (
          <RiderSection key={rider.id} rider={rider} deliveries={getRiderDeliveries(rider.id)} {...cardProps} />
        ))}
        {quickRiders.length > 0 && (
          <>
            <div className="self-stretch w-px bg-slate-200 flex-shrink-0 mx-1" />
            <div className="flex flex-col gap-3 flex-shrink-0">
              {quickRiders.map(rider => (
                <RiderSection key={rider.id} rider={rider} deliveries={getRiderDeliveries(rider.id)} {...cardProps} />
              ))}
            </div>
          </>
        )}
        {riders.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            라이더가 없습니다. Supabase에서 riders 테이블에 데이터를 추가하세요.
          </div>
        )}
      </section>
    </div>
  )
}
