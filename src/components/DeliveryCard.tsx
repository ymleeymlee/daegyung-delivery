'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Delivery } from '@/types'
import ElapsedTimer from './ElapsedTimer'

interface Props {
  delivery: Delivery
  isSelected: boolean
  onSelect: (delivery: Delivery) => void
  onDelete: (delivery: Delivery) => void
}

export default function DeliveryCard({ delivery, isSelected, onSelect, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: delivery.id,
    data: { delivery },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

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
      className={`relative overflow-visible bg-white rounded-xl shadow-sm border p-3 w-48 select-none flex-shrink-0 transition-all cursor-pointer ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500'
          : 'border-slate-200 hover:border-slate-300'
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

      {/* 상호명 + 주소 */}
      <p className="font-semibold text-sm truncate text-slate-800">{delivery.client_name}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate">{delivery.client_address}</p>

      {/* 시간 두 줄 */}
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
    </div>
  )
}
