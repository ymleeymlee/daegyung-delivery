'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Delivery } from '@/types'
import ElapsedTimer from './ElapsedTimer'

interface Props {
  delivery: Delivery
  isSelected: boolean
  onSelect: (delivery: Delivery) => void
  onDelete: (delivery: Delivery) => void
  gopoumRemaining?: number
  gopoumClientId?: string
  onGopoumPickup?: (gopoumClientId: string, deliveryId: string, qty: number) => void
}

export default function DeliveryCard({
  delivery, isSelected, onSelect, onDelete,
  gopoumRemaining, gopoumClientId, onGopoumPickup,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: delivery.id,
    data: { delivery },
  })
  const [pickupQty, setPickupQty] = useState(0)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const hasGopoum = (gopoumRemaining ?? 0) > 0
  const showPickupInput = delivery.status === 'assigned' && hasGopoum && gopoumClientId && onGopoumPickup

  const orderTime = new Date(delivery.created_at).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const assignedTime = delivery.assigned_at
    ? new Date(delivery.assigned_at).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  function handlePickupRecord(e: React.MouseEvent) {
    e.stopPropagation()
    if (pickupQty <= 0 || !gopoumClientId || !onGopoumPickup) return
    onGopoumPickup(gopoumClientId, delivery.id, pickupQty)
    setPickupQty(0)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(delivery)
      }}
      className={`relative overflow-visible rounded-xl shadow-sm border p-3 w-48 select-none flex-shrink-0 transition-all cursor-pointer ${
        hasGopoum
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
        onClick={(e) => {
          e.stopPropagation()
          if (!window.confirm('배달을 삭제하시겠습니까?')) return
          onDelete(delivery)
        }}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center text-xs transition-colors shadow-sm"
        title="삭제"
      >
        ×
      </button>

      {/* 고품 배지 */}
      {hasGopoum && (
        <div className="absolute -top-2 -left-2 bg-amber-400 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm leading-none whitespace-nowrap">
          고품 {gopoumRemaining}
        </div>
      )}

      {/* 상호명 + 주소 */}
      <p className="font-semibold text-sm truncate text-slate-800">{delivery.client_name}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate">{delivery.client_address}</p>

      {/* 시간 */}
      <div className="mt-2 pt-2 border-t border-slate-100 flex flex-col gap-0.5">
        <span className="text-xs text-slate-400">주문 {orderTime}</span>
        {delivery.status === 'waiting' ? (
          <span className="text-xs font-medium text-amber-600">
            대기 <ElapsedTimer startIso={delivery.created_at} />
          </span>
        ) : (
          <span className="text-xs font-medium text-blue-600">배정 {assignedTime}</span>
        )}
      </div>

      {/* 고품 수거 입력 (배정된 카드에만 표시) */}
      {showPickupInput && (
        <div
          className="mt-2 pt-2 border-t border-amber-200"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-amber-600 font-medium mb-1.5">고품 수거</p>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setPickupQty(q => Math.max(0, q - 1)) }}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-6 h-6 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-700 font-bold text-sm flex items-center justify-center transition-colors flex-shrink-0"
            >
              -
            </button>
            <span className="w-6 text-center text-sm font-semibold text-slate-700 flex-shrink-0">
              {pickupQty}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setPickupQty(q => q + 1) }}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-6 h-6 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-700 font-bold text-sm flex items-center justify-center transition-colors flex-shrink-0"
            >
              +
            </button>
            <button
              onClick={handlePickupRecord}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={pickupQty <= 0}
              className="flex-1 h-6 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              기록
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
