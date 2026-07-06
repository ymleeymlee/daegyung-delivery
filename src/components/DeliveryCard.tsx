'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Delivery, GopoumItem } from '@/types'
import ElapsedTimer from './ElapsedTimer'

interface Props {
  delivery: Delivery
  isSelected: boolean
  onSelect: (delivery: Delivery) => void
  onDelete: (delivery: Delivery) => void
  gopoumItems?: GopoumItem[]
  gopoumClientId?: string
  onCollectItem?: (itemId: string, deliveryId: string, riderName: string) => void
}

function GopoumModal({
  items,
  riderName,
  onCollect,
  onClose,
}: {
  items: GopoumItem[]
  riderName: string
  onCollect: (itemId: string) => void
  onClose: () => void
}) {
  const uncollected = items.filter(i => !i.picked_at)
  const collected = items.filter(i => i.picked_at)

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-80 max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <span className="font-bold text-slate-800">고품 수거</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {/* 미수거 아이템 - 버튼으로 */}
          {uncollected.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-400 font-semibold px-1">미수거 ({uncollected.length}개)</p>
              {uncollected.map(item => (
                <button
                  key={item.id}
                  onClick={() => onCollect(item.id)}
                  className="w-full text-left px-4 py-3 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 border border-amber-200 rounded-xl text-sm font-medium text-amber-800 transition-colors"
                >
                  {item.description}
                </button>
              ))}
            </div>
          )}

          {/* 수거 완료 아이템 */}
          {collected.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <p className="text-xs text-slate-400 font-semibold px-1">수거 완료 ({collected.length}개)</p>
              {collected.map(item => (
                <div key={item.id} className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl">
                  <span className="text-green-600 font-bold">✓</span>
                  <span className="text-sm text-green-700 line-through flex-1">{item.description}</span>
                  <span className="text-xs text-green-500 whitespace-nowrap">{item.rider_name}</span>
                </div>
              ))}
            </div>
          )}

          {items.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">등록된 품목이 없습니다.</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium text-slate-700 transition-colors">
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function DeliveryCard({
  delivery, isSelected, onSelect, onDelete,
  gopoumItems, gopoumClientId, onCollectItem,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: delivery.id,
    data: { delivery },
  })
  const [showModal, setShowModal] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const uncollectedCount = (gopoumItems ?? []).filter(i => !i.picked_at).length
  const totalCount = gopoumItems?.length ?? 0
  const hasGopoum = totalCount > 0
  const isGopoumCard = hasGopoum

  const orderTime = new Date(delivery.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  const assignedTime = delivery.assigned_at
    ? new Date(delivery.assigned_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null

  function handleCollect(itemId: string) {
    const rider = delivery.rider_id
      ? (gopoumItems ?? []).find(i => i.delivery_id === delivery.id)?.rider_name ?? '배달자'
      : '배달자'
    if (onCollectItem) onCollectItem(itemId, delivery.id, rider)
  }

  // riderName 전달용: 보드에서 delivery.rider_id로 찾아서 전달해줌
  const riderName = '배달자' // 보드에서 override

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={(e) => { e.stopPropagation(); onSelect(delivery) }}
        className={`relative overflow-visible rounded-xl shadow-sm border p-3 w-48 select-none flex-shrink-0 transition-all cursor-pointer ${
          isGopoumCard
            ? isSelected
              ? 'bg-amber-50 border-blue-500 ring-2 ring-blue-500'
              : 'bg-amber-50 border-amber-300 hover:border-amber-400'
            : isSelected
              ? 'bg-white border-blue-500 ring-2 ring-blue-500'
              : 'bg-white border-slate-200 hover:border-slate-300'
        }`}
      >
        {/* 삭제 버튼 */}
        <button
          onClick={(e) => { e.stopPropagation(); if (!window.confirm('배달을 삭제하시겠습니까?')) return; onDelete(delivery) }}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center text-xs transition-colors shadow-sm"
        >×</button>

        {/* 고품 배지 */}
        {isGopoumCard && (
          <div className={`absolute -top-2 -left-2 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm leading-none whitespace-nowrap ${
            uncollectedCount === 0 ? 'bg-green-500' : 'bg-amber-400'
          }`}>
            고품 {uncollectedCount > 0 ? uncollectedCount : totalCount}
          </div>
        )}

        {/* 상호명 + 주소 */}
        <p className="font-semibold text-sm truncate text-slate-800">{delivery.client_name}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate">{delivery.client_address}</p>

        {/* 시간 */}
        <div className="mt-2 pt-2 border-t border-slate-100 flex flex-col gap-0.5">
          <span className="text-xs text-slate-400">주문 {orderTime}</span>
          {delivery.status === 'waiting' ? (
            <span className="text-xs font-medium text-amber-600">대기 <ElapsedTimer startIso={delivery.created_at} /></span>
          ) : (
            <span className="text-xs font-medium text-blue-600">배정 {assignedTime}</span>
          )}
        </div>

        {/* 고품 N개 버튼 (배정됐을 때) */}
        {delivery.status === 'assigned' && hasGopoum && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowModal(true) }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`mt-2 w-full py-2 rounded-xl text-sm font-bold transition-colors ${
              uncollectedCount > 0
                ? 'bg-amber-400 hover:bg-amber-500 text-white'
                : 'bg-green-100 hover:bg-green-200 text-green-700'
            }`}
          >
            고품 {uncollectedCount > 0 ? `${uncollectedCount}개` : '완료 ✓'}
          </button>
        )}
      </div>

      {showModal && gopoumItems && (
        <GopoumModal
          items={gopoumItems}
          riderName={riderName}
          onCollect={handleCollect}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
