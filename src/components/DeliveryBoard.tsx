'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Delivery, RiderDevice, GopoumClient, GopoumItem } from '@/types'
import DeliveryCard from './DeliveryCard'
import QuickAddBar from './QuickAddBar'
import RiderAddModal from './RiderAddModal'
import { AppState, fetchAppState, isClosedNow, isBranchClosed, kstNowHm } from '@/lib/appState'
import { useBranch } from '@/lib/branch'

function deviceDisplayName(d: RiderDevice): string {
  return d.name ?? `이름 미입력 (기기 ${d.device_id.slice(0, 8)})`
}

function fmtKstHm(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch { return null }
}

function RiderSection({
  device, deliveries, selectedIds, onRiderClick, onSelect, onDelete,
  getGopoumData, onSetPickup, onAddToRider,
}: {
  device: RiderDevice
  deliveries: Delivery[]
  selectedIds: string[]
  onRiderClick: (riderId: string, e: React.MouseEvent) => void
  onSelect: (delivery: Delivery) => void
  onDelete: (d: Delivery) => void
  getGopoumData: (d: Delivery) => { clientId: string; items: GopoumItem[] } | null
  onSetPickup: (itemId: string, deliveryId: string, riderName: string, quantity: number) => void
  onAddToRider: (riderId: string, clientName: string, clientAddress: string, clientId?: string) => void
}) {
  const isClickable = selectedIds.length > 0 && device.rider_id !== null
  const [showAdd, setShowAdd] = useState(false)
  const displayName = deviceDisplayName(device)
  const canAssign = device.rider_id !== null

  return (
    <div
      onClick={(e) => canAssign ? onRiderClick(device.rider_id!, e) : undefined}
      className={`rounded-2xl shadow-sm border p-4 min-w-56 flex-shrink-0 transition-colors ${
        device.connected ? 'bg-white border-slate-200' : 'bg-slate-100 border-slate-200 opacity-60'
      } ${isClickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className={`text-sm font-semibold transition-colors ${isClickable ? 'text-blue-700' : 'text-slate-700'}`}>
          {displayName}
        </span>
        {device.phone && <span className="text-xs text-slate-400 font-medium">{device.phone}</span>}
        <span className="text-xs text-slate-300 font-mono">{device.device_id.slice(0, 8)}</span>
        {!device.connected && (
          <span className="text-[10px] font-bold bg-slate-300 text-slate-600 px-1.5 py-0.5 rounded-full leading-none">미접속</span>
        )}
        {!canAssign && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full leading-none">배정불가</span>
        )}
        <button
          onClick={async (e) => {
            e.stopPropagation()
            if (!confirm(`기기 "${displayName}"을 삭제하시겠습니까?\n(라이더 정보는 유지됩니다)`)) return
            const { error } = await supabase.from('rider_devices').delete().eq('device_id', device.device_id)
            if (error) alert(`삭제 실패: ${error.message}`)
          }}
          className="ml-auto text-xs font-bold text-red-300 hover:text-red-500 leading-none px-1 py-0.5 rounded transition-colors"
          title="기기 삭제 (라이더 정보 유지)"
        >✕</button>
      </div>
      {device.today_first_connected_at && (
        <p className="text-xs text-slate-500 mb-1">출근시간 : {fmtKstHm(device.today_first_connected_at)}</p>
      )}
      <p className="text-xs text-slate-500 text-center mb-3">총 배송 갯수 : {deliveries.length}</p>

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
              riderName={displayName}
              onSetPickup={onSetPickup}
            />
          )
        })}
      </div>

      {canAssign && (
        <div className="mt-2">
          <button
            onClick={(e) => { e.stopPropagation(); setShowAdd(true) }}
            className="w-full py-1.5 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-blue-300 hover:text-blue-500 text-sm font-medium transition-colors"
          >+ 추가</button>
        </div>
      )}
      {showAdd && canAssign && (
        <RiderAddModal
          riderName={displayName}
          onPick={(name, address, clientId) => onAddToRider(device.rider_id!, name, address, clientId)}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

export default function DeliveryBoard() {
  const { branch, branches } = useBranch()
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [devices, setDevices] = useState<RiderDevice[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [gopoumClients, setGopoumClients] = useState<GopoumClient[]>([])
  const [gopoumItems, setGopoumItems] = useState<GopoumItem[]>([])
  const [codeById, setCodeById] = useState<Map<string, string>>(new Map())
  const [coordById, setCoordById] = useState<Map<string, { lat: number; lng: number }>>(new Map())
  const [appState, setAppState] = useState<AppState>({ offset: 0, closedUntil: null })
  const [loading, setLoading] = useState(true)
  const [queueOpen, setQueueOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    const [{ data: d }, { data: devs }, { data: c }] = await Promise.all([
      supabase.from('deliveries').select('*').eq('branch', branch).order('sort_order'),
      supabase.from('rider_devices').select('*').eq('branch', branch).order('created_at'),
      supabase.from('clients').select('id, code, lat, lng').eq('branch', branch),
    ])
    setDeliveries(d ?? [])
    setDevices((devs ?? []) as RiderDevice[])
    const map = new Map<string, string>()
    const coords = new Map<string, { lat: number; lng: number }>()
    for (const cl of (c ?? []) as { id: string; code: string | null; lat: number | null; lng: number | null }[]) {
      if (cl.code?.trim()) map.set(cl.id, cl.code.trim())
      if (cl.lat != null && cl.lng != null) coords.set(cl.id, { lat: cl.lat, lng: cl.lng })
    }
    setCodeById(map)
    setCoordById(coords)
  }, [branch])

  const fetchGopoum = useCallback(async () => {
    const [{ data: gClients }, { data: gItems }] = await Promise.all([
      supabase.from('gopoum_clients').select('*').eq('branch', branch),
      supabase.from('gopoum_items').select('*'),
    ])
    setGopoumClients(gClients ?? [])
    const allItems = gItems ?? []
    setGopoumItems(allItems.filter((i: { archived_at: string | null }) => !i.archived_at))
  }, [branch])

  const refreshAppState = useCallback(async () => { setAppState(await fetchAppState()) }, [])

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_devices' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_clients' }, debouncedFetchGopoum)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_items' }, debouncedFetchGopoum)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, refreshAppState)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAll, fetchGopoum, debouncedFetchGopoum, refreshAppState])

  const gopoumMap = useMemo(() => {
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
    const code = d.client_id ? codeById.get(d.client_id) : undefined
    let items: GopoumItem[] | null = null
    if (code && gopoumMap.byCode.has(code)) {
      items = gopoumMap.byCode.get(code)!
    } else if (gopoumMap.byName.has(d.client_name)) {
      items = gopoumMap.byName.get(d.client_name)!
    }
    if (!items) return null
    const createdCut = d.created_at
    const snapshot = items.filter(i => i.created_at <= createdCut)
    return { clientId: '', items: snapshot }
  }

  function handleAdd(clientName: string, clientAddress: string, clientId?: string) {
    const nowHm = kstNowHm(appState.offset)
    const branchInfo = branches.find(b => b.code === branch)
    if (isBranchClosed(nowHm, branchInfo?.open_time, branchInfo?.close_time) || isClosedNow(appState)) {
      alert('마감된 상태입니다. 배송을 추가할 수 없습니다.'); return
    }
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.status === 'waiting').map(d => d.sort_order))
    const now = new Date().toISOString()
    const coord = clientId ? coordById.get(clientId) : undefined
    const row: Delivery = {
      id: crypto.randomUUID(), client_id: clientId ?? null, client_name: clientName,
      client_address: clientAddress, status: 'waiting', created_at: now,
      assigned_at: null, rider_id: null, sort_order: maxOrder + 1,
      dest_lat: coord?.lat ?? null, dest_lng: coord?.lng ?? null, branch,
    }
    setDeliveries(prev => [...prev, row])
    supabase.from('deliveries').insert(row).then(({ error }) => { if (error) fetchAll() })
  }

  function handleAddToRider(riderId: string, clientName: string, clientAddress: string, clientId?: string) {
    const nowHm = kstNowHm(appState.offset)
    const branchInfo = branches.find(b => b.code === branch)
    if (isBranchClosed(nowHm, branchInfo?.open_time, branchInfo?.close_time) || isClosedNow(appState)) {
      alert('마감된 상태입니다. 배송을 추가할 수 없습니다.'); return
    }
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.rider_id === riderId && (d.status === 'assigned' || d.status === 'completed')).map(d => d.sort_order))
    const now = new Date().toISOString()
    const coord = clientId ? coordById.get(clientId) : undefined
    const row: Delivery = {
      id: crypto.randomUUID(), client_id: clientId ?? null, client_name: clientName,
      client_address: clientAddress, status: 'assigned', created_at: now,
      assigned_at: now, rider_id: riderId, sort_order: maxOrder + 1,
      dest_lat: coord?.lat ?? null, dest_lng: coord?.lng ?? null, branch,
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

  function handleCardClick(clicked: Delivery) {
    if (clicked.status === 'waiting') {
      setSelectedIds(prev =>
        prev.includes(clicked.id) ? prev.filter(id => id !== clicked.id) : [...prev, clicked.id]
      )
      return
    }
    if (selectedIds.length > 0 && clicked.rider_id) assignSelectedToRider(clicked.rider_id)
  }

  function assignSelectedToRider(riderId: string) {
    if (selectedIds.length === 0) return
    const targets = selectedIds
      .map(id => deliveries.find(d => d.id === id))
      .filter((d): d is Delivery => !!d && !(d.rider_id === riderId && d.status === 'assigned'))
    if (targets.length === 0) { setSelectedIds([]); return }
    const now = new Date().toISOString()
    const base = Math.max(0, ...deliveries.filter(d => d.rider_id === riderId && (d.status === 'assigned' || d.status === 'completed')).map(d => d.sort_order))
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

  function getDeviceDeliveries(riderId: string) {
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

      {/* 라이더(기기) 구역 */}
      <section className="flex gap-4 overflow-x-auto pb-2 items-start">
        {devices.map(device => (
          <RiderSection
            key={device.device_id}
            device={device}
            deliveries={device.rider_id ? getDeviceDeliveries(device.rider_id) : []}
            {...cardProps}
          />
        ))}
        {devices.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            접속한 기기가 없습니다. 라이더 앱에서 출근하면 여기에 표시됩니다.
          </div>
        )}
      </section>
    </div>
  )
}
