'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { supabase } from '@/lib/supabase'
import { Delivery, Rider, GopoumClient, GopoumItem } from '@/types'
import DeliveryCard from './DeliveryCard'
import QuickAddBar from './QuickAddBar'
import { syncSheet } from '@/lib/syncSheet'

function DroppableZone({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`${className} transition-colors ${isOver ? 'ring-2 ring-blue-400 ring-inset rounded-xl' : ''}`}>
      {children}
    </div>
  )
}

function RiderSection({
  rider, deliveries, selectedCardId, onRiderClick, onSelect, onDelete,
  strategy = 'vertical', getGopoumData, onCollectItem, onUncollectItem,
}: {
  rider: Rider
  deliveries: Delivery[]
  selectedCardId: string | null
  onRiderClick: (riderId: string, e: React.MouseEvent) => void
  onSelect: (delivery: Delivery) => void
  onDelete: (d: Delivery) => void
  strategy?: 'vertical' | 'horizontal'
  getGopoumData: (d: Delivery) => { clientId: string; items: GopoumItem[] } | null
  onCollectItem: (itemId: string, deliveryId: string, riderName: string) => void
  onUncollectItem: (itemId: string) => void
}) {
  const isClickable = selectedCardId !== null
  const sortStrategy = strategy === 'vertical' ? verticalListSortingStrategy : horizontalListSortingStrategy

  return (
    <div
      onClick={(e) => onRiderClick(rider.id, e)}
      className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 min-w-56 flex-shrink-0 transition-colors ${isClickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30' : ''}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-sm font-semibold transition-colors ${isClickable ? 'text-blue-700' : 'text-slate-700'}`}>{rider.name}</span>
        <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{deliveries.length}</span>
      </div>

      <DroppableZone id={`rider-${rider.id}`} className="min-h-20 flex flex-col gap-2">
        <SortableContext items={deliveries.map(d => d.id)} strategy={sortStrategy}>
          {deliveries.length === 0 && <p className="text-xs text-slate-300 italic text-center py-4">배달 없음</p>}
          {deliveries.map(d => {
            const gd = getGopoumData(d)
            return (
              <DeliveryCard
                key={d.id}
                delivery={d}
                isSelected={selectedCardId === d.id}
                onSelect={onSelect}
                onDelete={onDelete}
                gopoumItems={gd?.items}
                gopoumClientId={gd?.clientId}
                riderName={rider.name}
                onCollectItem={onCollectItem}
                onUncollectItem={onUncollectItem}
              />
            )
          })}
        </SortableContext>
      </DroppableZone>
    </div>
  )
}

export default function DeliveryBoard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [riders, setRiders] = useState<Rider[]>([])
  const [activeDelivery, setActiveDelivery] = useState<Delivery | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [gopoumClients, setGopoumClients] = useState<GopoumClient[]>([])
  const [gopoumItems, setGopoumItems] = useState<GopoumItem[]>([])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const fetchAll = useCallback(async () => {
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase.from('deliveries').select('*').not('status', 'in', '("completed")').order('sort_order'),
      supabase.from('riders').select('*').eq('is_active', true).order('created_at'),
    ])
    setDeliveries(d ?? [])
    setRiders(r ?? [])
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

  useEffect(() => {
    fetchAll()
    fetchGopoum()
    const channel = supabase
      .channel('board-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => { fetchAll(); syncSheet('delivery') })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_clients' }, () => { fetchGopoum(); syncSheet('gopoum') })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gopoum_items' }, () => { fetchGopoum(); syncSheet('gopoum') })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAll, fetchGopoum])

  const gopoumMap = useMemo(() => {
    const byId = new Map<string, { clientId: string; items: GopoumItem[] }>()
    const byName = new Map<string, { clientId: string; items: GopoumItem[] }>()
    for (const gc of gopoumClients) {
      const items = gopoumItems.filter(i => i.gopoum_client_id === gc.id)
      if (gc.client_id) byId.set(gc.client_id, { clientId: gc.id, items })
      byName.set(gc.client_name, { clientId: gc.id, items })
    }
    return { byId, byName }
  }, [gopoumClients, gopoumItems])

  function getGopoumData(d: Delivery) {
    if (d.client_id && gopoumMap.byId.has(d.client_id)) return gopoumMap.byId.get(d.client_id)!
    if (gopoumMap.byName.has(d.client_name)) return gopoumMap.byName.get(d.client_name)!
    return null
  }

  function handleAdd(clientName: string, clientAddress: string, clientId?: string) {
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.status === 'waiting').map(d => d.sort_order))
    const now = new Date().toISOString()
    const row: Delivery = {
      id: crypto.randomUUID(), client_id: clientId ?? null, client_name: clientName,
      client_address: clientAddress, status: 'waiting', created_at: now,
      assigned_at: null, rider_id: null, sort_order: maxOrder + 1,
    }
    setDeliveries(prev => [...prev, row])
    supabase.from('deliveries').insert(row).then(({ error }) => { if (error) fetchAll() })
  }

  function handleAssign(deliveryId: string, riderId: string) {
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.rider_id === riderId && d.status === 'assigned').map(d => d.sort_order))
    const now = new Date().toISOString()
    setDeliveries(prev => prev.map(d => d.id === deliveryId ? { ...d, rider_id: riderId, status: 'assigned', assigned_at: now, sort_order: maxOrder + 1 } : d))
    supabase.from('deliveries').update({ rider_id: riderId, status: 'assigned', assigned_at: now, sort_order: maxOrder + 1 }).eq('id', deliveryId).then(({ error }) => { if (error) fetchAll() })
  }

  function handleUnassign(deliveryId: string) {
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.status === 'waiting').map(d => d.sort_order))
    setDeliveries(prev => prev.map(d => d.id === deliveryId ? { ...d, rider_id: null, status: 'waiting', assigned_at: null, sort_order: maxOrder + 1 } : d))
    supabase.from('deliveries').update({ rider_id: null, status: 'waiting', assigned_at: null, sort_order: maxOrder + 1 }).eq('id', deliveryId).then(({ error }) => { if (error) fetchAll() })
  }

  function handleDelete(delivery: Delivery) {
    if (selectedCardId === delivery.id) setSelectedCardId(null)
    setDeliveries(prev => prev.filter(d => d.id !== delivery.id))
    setGopoumItems(prev => prev.filter(i => i.delivery_id !== delivery.id))
    supabase.from('deliveries').delete().eq('id', delivery.id).then(({ error }) => { if (error) fetchAll() })
  }

  function handleCollectItem(itemId: string, deliveryId: string, riderName: string) {
    const pickedAt = new Date().toISOString()
    setGopoumItems(prev => prev.map(i => i.id === itemId ? { ...i, rider_name: riderName, delivery_id: deliveryId, picked_at: pickedAt } : i))
    fetch('/api/gopoum-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, rider_name: riderName, delivery_id: deliveryId, picked_at: pickedAt }),
    }).then(res => { if (!res.ok) fetchGopoum() })
  }

  function handleUncollectItem(itemId: string) {
    setGopoumItems(prev => prev.map(i => i.id === itemId ? { ...i, rider_name: null, delivery_id: null, picked_at: null } : i))
    fetch('/api/gopoum-items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, rider_name: null, delivery_id: null, picked_at: null }),
    }).then(res => { if (!res.ok) fetchGopoum() })
  }

  function moveSelectedTo(zone: 'waiting' | 'rider', riderId?: string) {
    if (!selectedCardId) return
    const sel = deliveries.find(d => d.id === selectedCardId)
    if (!sel) { setSelectedCardId(null); return }
    if (zone === 'rider' && riderId) {
      if (!(sel.rider_id === riderId && sel.status === 'assigned')) handleAssign(selectedCardId, riderId)
    } else if (zone === 'waiting' && sel.status !== 'waiting') {
      handleUnassign(selectedCardId)
    }
    setSelectedCardId(null)
  }

  function handleCardClick(clicked: Delivery) {
    if (selectedCardId === clicked.id) { setSelectedCardId(null); return }
    if (selectedCardId) {
      if (clicked.status === 'waiting') moveSelectedTo('waiting')
      else if (clicked.rider_id) moveSelectedTo('rider', clicked.rider_id)
      return
    }
    setSelectedCardId(clicked.id)
  }

  function handleRiderClick(riderId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!selectedCardId) return
    moveSelectedTo('rider', riderId)
  }

  function handleWaitingZoneClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!selectedCardId) return
    moveSelectedTo('waiting')
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDelivery(deliveries.find(d => d.id === event.active.id) ?? null)
    setSelectedCardId(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDelivery(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const overId = String(over.id)
    if (overId.startsWith('rider-')) handleAssign(String(active.id), overId.replace('rider-', ''))
    else if (overId === 'waiting-zone') handleUnassign(String(active.id))
  }

  const waitingDeliveries = deliveries.filter(d => d.status === 'waiting').sort((a, b) => a.sort_order - b.sort_order)
  const regularRiders = riders.filter(r => !r.is_quick)
  const quickRiders = riders.filter(r => r.is_quick)

  function getRiderDeliveries(riderId: string) {
    return deliveries.filter(d => d.rider_id === riderId && d.status === 'assigned').sort((a, b) => a.sort_order - b.sort_order)
  }

  const cardProps = {
    selectedCardId,
    onRiderClick: handleRiderClick,
    onSelect: handleCardClick,
    onDelete: handleDelete,
    getGopoumData,
    onCollectItem: handleCollectItem,
    onUncollectItem: handleUncollectItem,
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="p-4 flex flex-col gap-4 min-h-[calc(100vh-56px)]" onClick={() => setSelectedCardId(null)}>
        {/* 대기열 */}
        <section onClick={handleWaitingZoneClick} className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 transition-colors ${selectedCardId ? 'cursor-pointer hover:border-amber-300 hover:bg-amber-50/30' : ''}`}>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">대기열</span>
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{waitingDeliveries.length}</span>
            </div>
            <QuickAddBar onAdd={handleAdd} />
          </div>
          <DroppableZone id="waiting-zone" className="min-h-16 flex gap-3 flex-wrap">
            <SortableContext items={waitingDeliveries.map(d => d.id)} strategy={horizontalListSortingStrategy}>
              {waitingDeliveries.length === 0 && <p className="text-sm text-slate-300 italic self-center">배달 카드를 추가하거나 드래그해서 놓으세요</p>}
              {waitingDeliveries.map(d => {
                const gd = getGopoumData(d)
                return (
                  <DeliveryCard
                    key={d.id} delivery={d}
                    isSelected={selectedCardId === d.id}
                    onSelect={handleCardClick} onDelete={handleDelete}
                    gopoumItems={gd?.items} gopoumClientId={gd?.clientId}
                    onCollectItem={handleCollectItem}
                    onUncollectItem={handleUncollectItem}
                  />
                )
              })}
            </SortableContext>
          </DroppableZone>
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

      <DragOverlay>
        {activeDelivery && (
          <div className="bg-white rounded-xl shadow-lg border-2 border-blue-400 p-3 w-48 rotate-2">
            <p className="font-semibold text-sm text-slate-800 truncate">{activeDelivery.client_name}</p>
            <p className="text-xs text-slate-400 truncate">{activeDelivery.client_address}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
