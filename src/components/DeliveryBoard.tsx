'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { supabase } from '@/lib/supabase'
import { Delivery, Rider } from '@/types'
import DeliveryCard from './DeliveryCard'
import AddDeliveryModal from './AddDeliveryModal'

function DroppableZone({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`${className} transition-colors ${isOver ? 'ring-2 ring-blue-400 ring-inset rounded-xl' : ''}`}
    >
      {children}
    </div>
  )
}

// 라이더 컬럼 (일반 + 퀵 공통)
function RiderSection({
  rider,
  deliveries,
  selectedCardId,
  onRiderClick,
  onSelect,
  onDelete,
  onRestore,
  strategy = 'vertical',
}: {
  rider: Rider
  deliveries: Delivery[]
  selectedCardId: string | null
  onRiderClick: (riderId: string, e: React.MouseEvent) => void
  onSelect: (id: string) => void
  onDelete: (d: Delivery) => void
  onRestore: (id: string) => void
  strategy?: 'vertical' | 'horizontal'
}) {
  const isClickable = selectedCardId !== null
  const sortStrategy = strategy === 'vertical' ? verticalListSortingStrategy : horizontalListSortingStrategy

  return (
    <div
      onClick={(e) => onRiderClick(rider.id, e)}
      className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 min-w-56 flex-shrink-0 transition-colors ${
        isClickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30' : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-sm font-semibold transition-colors ${isClickable ? 'text-blue-700' : 'text-slate-700'}`}>
          {rider.name}
        </span>
        <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
          {deliveries.filter(d => d.status !== 'cancelled').length}
        </span>
      </div>

      <DroppableZone id={`rider-${rider.id}`} className="min-h-20 flex flex-col gap-2">
        <SortableContext items={deliveries.map(d => d.id)} strategy={sortStrategy}>
          {deliveries.length === 0 && (
            <p className="text-xs text-slate-300 italic text-center py-4">배달 없음</p>
          )}
          {deliveries.map(d => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              isSelected={selectedCardId === d.id}
              onSelect={onSelect}
              onDelete={onDelete}
              onRestore={onRestore}
            />
          ))}
        </SortableContext>
      </DroppableZone>
    </div>
  )
}

export default function DeliveryBoard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [riders, setRiders] = useState<Rider[]>([])
  const [showModal, setShowModal] = useState(false)
  const [activeDelivery, setActiveDelivery] = useState<Delivery | null>(null)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const fetchAll = useCallback(async () => {
    const [{ data: d }, { data: r }] = await Promise.all([
      supabase
        .from('deliveries')
        .select('*')
        .not('status', 'in', '("completed")')
        .order('sort_order'),
      supabase.from('riders').select('*').eq('is_active', true).order('created_at'),
    ])
    setDeliveries(d ?? [])
    setRiders(r ?? [])
  }, [])

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel('deliveries-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  async function handleAdd(clientName: string, clientAddress: string, clientId?: string) {
    const maxOrder = Math.max(0, ...deliveries.filter(d => d.status === 'waiting').map(d => d.sort_order))
    await supabase.from('deliveries').insert({
      client_id: clientId ?? null,
      client_name: clientName,
      client_address: clientAddress,
      status: 'waiting',
      sort_order: maxOrder + 1,
    })
  }

  async function handleAssign(deliveryId: string, riderId: string) {
    const riderDeliveries = deliveries.filter(
      d => d.rider_id === riderId && d.status === 'assigned'
    )
    const maxOrder = Math.max(0, ...riderDeliveries.map(d => d.sort_order))
    await supabase.from('deliveries').update({
      rider_id: riderId,
      status: 'assigned',
      assigned_at: new Date().toISOString(),
      sort_order: maxOrder + 1,
    }).eq('id', deliveryId)
  }

  async function handleUnassign(deliveryId: string) {
    const waitingDeliveries = deliveries.filter(d => d.status === 'waiting')
    const maxOrder = Math.max(0, ...waitingDeliveries.map(d => d.sort_order))
    await supabase.from('deliveries').update({
      rider_id: null,
      status: 'waiting',
      assigned_at: null,
      sort_order: maxOrder + 1,
    }).eq('id', deliveryId)
  }

  // 삭제: 대기열 → hard delete / 배정된 → cancelled
  async function handleDelete(delivery: Delivery) {
    if (delivery.status === 'waiting') {
      await supabase.from('deliveries').delete().eq('id', delivery.id)
    } else {
      await supabase.from('deliveries').update({ status: 'cancelled' }).eq('id', delivery.id)
    }
    if (selectedCardId === delivery.id) setSelectedCardId(null)
  }

  // 복원: cancelled → assigned
  async function handleRestore(deliveryId: string) {
    await supabase.from('deliveries').update({ status: 'assigned' }).eq('id', deliveryId)
  }

  function handleCardSelect(cardId: string) {
    setSelectedCardId(prev => (prev === cardId ? null : cardId))
  }

  async function handleRiderClick(riderId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!selectedCardId) return
    await handleAssign(selectedCardId, riderId)
    setSelectedCardId(null)
  }

  function handleDragStart(event: DragStartEvent) {
    const d = deliveries.find(d => d.id === event.active.id)
    setActiveDelivery(d ?? null)
    setSelectedCardId(null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDelivery(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const overId = String(over.id)
    if (overId.startsWith('rider-')) {
      const riderId = overId.replace('rider-', '')
      await handleAssign(String(active.id), riderId)
    } else if (overId === 'waiting-zone') {
      await handleUnassign(String(active.id))
    }
  }

  const waitingDeliveries = deliveries.filter(d => d.status === 'waiting')

  // is_quick 필드가 없는 구버전 데이터도 안전하게 처리
  const regularRiders = riders.filter(r => !r.is_quick)
  const quickRiders = riders.filter(r => r.is_quick)

  function getRiderDeliveries(riderId: string) {
    return deliveries.filter(
      d => d.rider_id === riderId && (d.status === 'assigned' || d.status === 'cancelled')
    )
  }

  const cardProps = {
    selectedCardId,
    onRiderClick: handleRiderClick,
    onSelect: handleCardSelect,
    onDelete: handleDelete,
    onRestore: handleRestore,
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        className="p-4 flex flex-col gap-4 min-h-[calc(100vh-56px)]"
        onClick={() => setSelectedCardId(null)}
      >
        {/* 대기열 */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">대기열</span>
              <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {waitingDeliveries.length}
              </span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setShowModal(true) }}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-xl transition-colors"
            >
              <span className="text-base leading-none">+</span> 배달 추가
            </button>
          </div>
          <DroppableZone id="waiting-zone" className="min-h-16 flex gap-3 flex-wrap">
            <SortableContext items={waitingDeliveries.map(d => d.id)} strategy={horizontalListSortingStrategy}>
              {waitingDeliveries.length === 0 && (
                <p className="text-sm text-slate-300 italic self-center">
                  배달 카드를 추가하거나 드래그해서 놓으세요
                </p>
              )}
              {waitingDeliveries.map(d => (
                <DeliveryCard
                  key={d.id}
                  delivery={d}
                  isSelected={selectedCardId === d.id}
                  onSelect={handleCardSelect}
                  onDelete={handleDelete}
                  onRestore={handleRestore}
                />
              ))}
            </SortableContext>
          </DroppableZone>
        </section>

        {/* 라이더 + 퀵 구역 */}
        <section className="flex gap-4 overflow-x-auto pb-2 items-start">

          {/* 일반 라이더 컬럼 */}
          {regularRiders.map(rider => (
            <RiderSection
              key={rider.id}
              rider={rider}
              deliveries={getRiderDeliveries(rider.id)}
              {...cardProps}
            />
          ))}

          {/* 구분선 + 퀵 구역 */}
          {quickRiders.length > 0 && (
            <>
              <div className="self-stretch w-px bg-slate-200 flex-shrink-0 mx-1" />

              <div className="flex flex-col gap-3 flex-shrink-0">
                {quickRiders.map(rider => (
                  <RiderSection
                    key={rider.id}
                    rider={rider}
                    deliveries={getRiderDeliveries(rider.id)}
                    {...cardProps}
                  />
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

      {showModal && (
        <AddDeliveryModal onClose={() => setShowModal(false)} onAdd={handleAdd} />
      )}
    </DndContext>
  )
}
