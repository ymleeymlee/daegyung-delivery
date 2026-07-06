'use client'

import { useState, useEffect, useRef } from 'react'
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
  onGopoumPickup?: (
    gopoumClientId: string,
    deliveryId: string,
    qty: number,
    existingPickupId?: string
  ) => Promise<string | undefined>
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
  const [maxPickup, setMaxPickup] = useState(0)
  const [recorded, setRecorded] = useState(false)
  const [pickupId, setPickupId] = useState<string | undefined>()
  const [lastRecordedQty, setLastRecordedQty] = useState<number | null>(null)
  const initialized = useRef(false)

  // 배정됐을 때 잔여 고품 수를 기본값으로 설정 (최초 1회)
  useEffect(() => {
    if (
      delivery.status === 'assigned' &&
      (gopoumRemaining ?? 0) > 0 &&
      !initialized.current
    ) {
      initialized.current = true
      setPickupQty(gopoumRemaining!)
      setMaxPickup(gopoumRemaining!)
    }
  }, [delivery.status, gopoumRemaining])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const hasGopoum = (gopoumRemaining ?? 0) > 0
  const showGopoum = delivery.status === 'assigned' && !!gopoumClientId && !!onGopoumPickup && (hasGopoum || recorded)
  const showBadge = hasGopoum || recorded

  // 갱신 시 최대치 = 남은 수량 + 내가 이미 기록한 수량 (교체 방식이므로)
  const effectiveMax = (gopoumRemaining ?? 0) + (lastRecordedQty ?? 0)

  // 기록 버튼 비활성 조건: 이미 기록했고 수량이 마지막 기록과 동일
  const recordDisabled = recorded && lastRecordedQty === pickupQty

  const orderTime = new Date(delivery.created_at).toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit',
  })
  const assignedTime = delivery.assigned_at
    ? new Date(delivery.assigned_at).toLocaleTimeString('ko-KR', {
        hour: '2-digit', minute: '2-digit',
      })
    : null

  async function handleRecord(e: React.MouseEvent) {
    e.stopPropagation()
    if (pickupQty <= 0 || !gopoumClientId || !onGopoumPickup) return
    const newId = await onGopoumPickup(gopoumClientId, delivery.id, pickupQty, pickupId)
    if (newId) setPickupId(newId)
    setLastRecordedQty(pickupQty)
    setRecorded(true)
  }

  function changeQty(delta: number) {
    setPickupQty(q => {
      const next = q + delta
      if (next < 0 || next > effectiveMax) return q
      return next
    })
  }

  const isGopoumCard = hasGopoum || recorded

  return (
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
        onClick={(e) => {
          e.stopPropagation()
          if (!window.confirm('배달을 삭제하시겠습니까?')) return
          onDelete(delivery)
        }}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center text-xs transition-colors shadow-sm"
      >×</button>

      {/* 고품 배지 */}
      {showBadge && (
        <div className={`absolute -top-2 -left-2 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm leading-none whitespace-nowrap ${
          recorded && !hasGopoum ? 'bg-green-500' : 'bg-amber-400'
        }`}>
          고품 {hasGopoum ? gopoumRemaining : maxPickup}
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

      {/* 고품 수거 입력 */}
      {showGopoum && (
        <div
          className="mt-2 pt-2 border-t border-amber-200"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-amber-600 font-semibold mb-2">고품 수거</p>

          {/* +/- 버튼 (크게) */}
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={(e) => { e.stopPropagation(); changeQty(-1) }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={pickupQty <= 0}
              className="w-12 h-12 rounded-xl bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-700 font-bold text-2xl flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
            >−</button>
            <span className="flex-1 text-center text-xl font-bold text-slate-800">{pickupQty}</span>
            <button
              onClick={(e) => { e.stopPropagation(); changeQty(1) }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={pickupQty >= effectiveMax}
              className="w-12 h-12 rounded-xl bg-amber-100 hover:bg-amber-200 active:bg-amber-300 text-amber-700 font-bold text-2xl flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
            >+</button>
          </div>

          {/* 기록 버튼 (아래, 크게) */}
          <button
            onClick={handleRecord}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={recordDisabled || pickupQty <= 0}
            className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {recorded && lastRecordedQty === pickupQty ? '기록됨 ✓' : '기록'}
          </button>
        </div>
      )}
    </div>
  )
}
