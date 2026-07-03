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
  onRestore: (deliveryId: string) => void
}

export default function DeliveryCard({ delivery, isSelected, onSelect, onDelete, onRestore }: Props) {
  const isCancelled = delivery.status === 'cancelled'

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: delivery.id,
    data: { delivery },
    disabled: isCancelled, // 취소된 카드는 드래그 비활성
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
      {...(isCancelled ? {} : attributes)}
      {...(isCancelled ? {} : listeners)}
      onClick={(e) => {
        // 취소된 카드는 클릭을 상위 이름블록으로 전달(버블링)해서, 선택된 카드가 그 블록에 배정되도록 함
        if (isCancelled) return
        e.stopPropagation()
        onSelect(delivery)
      }}
      className={`relative overflow-visible bg-white rounded-xl shadow-sm border p-3 w-48 select-none flex-shrink-0 transition-all ${
        isCancelled
          ? 'border-slate-200 opacity-60 cursor-default'
          : isSelected
          ? 'border-blue-500 ring-2 ring-blue-500 cursor-pointer'
          : 'border-slate-200 hover:border-slate-300 cursor-pointer'
      }`}
    >
      {/* 삭제 뱃지 또는 복원 버튼 */}
      {isCancelled ? (
        <button
          onClick={(e) => { e.stopPropagation(); onRestore(delivery.id) }}
          className="absolute top-2 right-2 text-xs text-blue-500 hover:text-blue-700 font-medium px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors"
        >
          복원
        </button>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (delivery.status === 'waiting') {
              if (!window.confirm('배달을 삭제하시겠습니까?')) return
            }
            onDelete(delivery)
          }}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center text-xs transition-colors shadow-sm"
          title="삭제"
        >
          ×
        </button>
      )}

      {/* 상호명 + 주소 */}
      <p
        className={`font-semibold text-sm truncate ${
          isCancelled ? 'text-slate-400 line-through' : 'text-slate-800'
        }`}
      >
        {delivery.client_name}
      </p>
      <p className="text-xs text-slate-400 mt-0.5 truncate">{delivery.client_address}</p>

      {/* 시간 두 줄 */}
      <div className="mt-2 pt-2 border-t border-slate-100 flex flex-col gap-0.5">
        <span className="text-xs text-slate-400">주문 {orderTime}</span>
        {delivery.status === 'waiting' ? (
          <span className="text-xs font-medium text-amber-600">
            대기 <ElapsedTimer startIso={delivery.created_at} />
          </span>
        ) : (
          <span className={`text-xs font-medium ${isCancelled ? 'text-slate-400' : 'text-blue-600'}`}>
            배정 {assignedTime}
          </span>
        )}
      </div>
    </div>
  )
}
