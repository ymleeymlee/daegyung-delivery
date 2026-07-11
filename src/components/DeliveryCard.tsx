'use client'

import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Delivery, GopoumItem } from '@/types'
import ElapsedTimer from './ElapsedTimer'

interface Props {
  delivery: Delivery
  isSelected: boolean
  hasSelection?: boolean
  onSelect: (delivery: Delivery) => void
  onDelete: (delivery: Delivery) => void
  gopoumItems?: GopoumItem[]
  gopoumClientId?: string
  riderName?: string
  onCollectItem?: (itemId: string, deliveryId: string, riderName: string) => void
  onUncollectItem?: (itemId: string) => void
  onSetQuantity?: (itemId: string, quantity: number) => void
}

const qty = (i: GopoumItem) => i.quantity ?? 1

function GopoumModal({
  items,
  deliveryId,
  onCollect,
  onUncollect,
  onSetQuantity,
  onClose,
}: {
  items: GopoumItem[]
  deliveryId: string
  onCollect: (itemId: string) => void
  onUncollect: (itemId: string) => void
  onSetQuantity: (itemId: string, quantity: number) => void
  onClose: () => void
}) {
  // 생성 순서(고품현황 추가 순)로 고정 — 수거/취소해도 위치가 바뀌지 않음
  const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))

  // 열 때의 원래 상태(수거 여부 / 수량) — 닫을 때 변경분만 커밋하기 위한 기준
  const original = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const i of items) m[i.id] = !!i.picked_at && i.delivery_id === deliveryId
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const initialQty = useMemo(() => {
    const m: Record<string, number> = {}
    for (const i of items) m[i.id] = qty(i)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 로컬 상태. 탭/증감은 여기만 바뀌고 DB 통신은 닫을 때 → 실시간 왕복 깜빡임 없음
  const [picks, setPicks] = useState<Record<string, boolean>>(original)
  const [qtys, setQtys] = useState<Record<string, number>>(initialQty)

  // 타 배송자가 수거한 아이템은 선택 불가(자리만 유지)
  const isOthers = (i: GopoumItem) => !!i.picked_at && i.delivery_id !== deliveryId
  const itemQty = (i: GopoumItem) => qtys[i.id] ?? qty(i)

  // 헤더 = 수거 수량 합 / 총 수량 합 (타 배송자 수거 + 내 로컬 선택 포함)
  const total = sorted.reduce((s, i) => s + itemQty(i), 0)
  const collectedNow = sorted.filter(i => isOthers(i) || picks[i.id]).reduce((s, i) => s + itemQty(i), 0)

  function toggle(id: string) {
    setPicks(p => ({ ...p, [id]: !p[id] }))
  }
  function changeQty(id: string, delta: number) {
    setQtys(p => ({ ...p, [id]: Math.max(1, (p[id] ?? 1) + delta) }))
  }

  // 닫을 때 변경분을 한 번에 커밋 (고품현황/DB 반영은 이 시점에만)
  function commitAndClose() {
    for (const i of items) {
      if (isOthers(i)) continue
      // 수량 변경 커밋
      const q = qtys[i.id] ?? qty(i)
      if (q !== initialQty[i.id]) onSetQuantity(i.id, q)
      // 수거 상태 변경 커밋
      const now = !!picks[i.id]
      if (now !== original[i.id]) {
        if (now) onCollect(i.id)
        else onUncollect(i.id)
      }
    }
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={commitAndClose}>
      <div className="bg-white rounded-2xl shadow-xl w-80 max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <span className="font-bold text-slate-800">고품 수거</span>
            <span className="ml-2 text-sm text-slate-500">{collectedNow}/{total}</span>
          </div>
          <button onClick={commitAndClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {/* 추가 순서 고정. 왼쪽 탭하면 수거(초록)/취소 토글, 오른쪽 −/+로 수량 (닫을 때 일괄 저장) */}
          {sorted.map(item => {
            if (isOthers(item)) {
              // 타 배송자 수거 — 비활성(자리 유지)
              return (
                <div key={item.id} className="flex items-center px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl opacity-50">
                  <span className="text-sm text-slate-400 line-through">{item.description}</span>
                  <span className="text-xs text-slate-400 ml-2 whitespace-nowrap">×{itemQty(item)} — {item.rider_name}</span>
                </div>
              )
            }
            const picked = !!picks[item.id]
            return (
              <div key={item.id}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                  picked ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-200'
                }`}>
                {/* 수거 토글 영역 */}
                <button onClick={() => toggle(item.id)} className="flex-1 min-w-0 text-left">
                  <span className={`text-sm font-medium ${picked ? 'text-green-700 line-through' : 'text-amber-800'}`}>{item.description}</span>
                  {picked && <span className="text-xs text-green-500 ml-2">✓</span>}
                </button>
                {/* 수량 −/값/+ */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => changeQty(item.id, -1)}
                    className="w-7 h-7 rounded-md bg-white border border-slate-200 text-slate-600 text-base leading-none flex items-center justify-center hover:bg-slate-100">−</button>
                  <span className="w-6 text-center text-sm font-semibold text-slate-700">{itemQty(item)}</span>
                  <button onClick={() => changeQty(item.id, 1)}
                    className="w-7 h-7 rounded-md bg-white border border-slate-200 text-slate-600 text-base leading-none flex items-center justify-center hover:bg-slate-100">+</button>
                </div>
              </div>
            )
          })}

          {items.length === 0 && <p className="text-sm text-slate-400 text-center py-4">등록된 품목이 없습니다.</p>}
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          <button onClick={commitAndClose} className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-medium text-slate-700 transition-colors">
            닫기
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function DeliveryCard({
  delivery, isSelected, hasSelection, onSelect, onDelete,
  gopoumItems, gopoumClientId, riderName, onCollectItem, onUncollectItem, onSetQuantity,
}: Props) {
  const [showModal, setShowModal] = useState(false)

  // 카드 생성 당시 스냅샷 품목 (getGopoumData가 생성 시점 기준으로 넘겨줌). 수량 합산 기준
  const gItems = gopoumItems ?? []
  const total = gItems.reduce((s, i) => s + qty(i), 0)                                    // 총수량 합
  const collectedCount = gItems.filter(i => i.picked_at).reduce((s, i) => s + qty(i), 0)  // 수거 수량 합 (누구든)
  const myCount = gItems.filter(i => i.picked_at && i.delivery_id === delivery.id).reduce((s, i) => s + qty(i), 0) // 내가 수거한 수량 합
  // 카드 생성 당시 "찾을 고품"이 있었는지 = 생성 시점에 미수거였던 품목이 하나라도 있었는지.
  // 없으면(전부 이미 수거됐거나 품목 자체가 없음) 이 카드엔 고품 표시 안 함.
  const hadGopoumAtCreation = gItems.some(i => !i.picked_at || i.picked_at > delivery.created_at)
  const hasGopoum = hadGopoumAtCreation
  const isGopoumCard = hasGopoum
  const collectedByMe = myCount > 0                              // 내가 하나라도 수거했으면 초록

  const assignedTime = delivery.assigned_at
    ? new Date(delivery.assigned_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null

  function handleCollect(itemId: string) {
    if (onCollectItem) onCollectItem(itemId, delivery.id, riderName ?? '배송자')
  }

  function handleUncollect(itemId: string) {
    if (onUncollectItem) onUncollectItem(itemId)
  }

  function handleSetQuantity(itemId: string, quantity: number) {
    if (onSetQuantity) onSetQuantity(itemId, quantity)
  }

  // 카드 클릭: 배정된 고품(노란) 카드는 선택 중이 아니면 카드 자체가 고품 버튼 → 팝업 열기.
  // 그 외(대기열 카드 / 선택 진행 중)는 기존 선택·배정 로직으로.
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (delivery.status === 'assigned' && hasGopoum && !hasSelection) {
      setShowModal(true)
      return
    }
    onSelect(delivery)
  }

  return (
    <>
      <div
        onClick={handleClick}
        className={`relative overflow-visible rounded-xl shadow-sm border p-3 w-48 select-none flex-shrink-0 transition-all cursor-pointer ${
          isGopoumCard
            ? isSelected ? 'bg-amber-50 border-blue-500 ring-2 ring-blue-500' : 'bg-amber-50 border-amber-300 hover:border-amber-400'
            : isSelected ? 'bg-white border-blue-500 ring-2 ring-blue-500' : 'bg-white border-slate-200 hover:border-slate-300'
        }`}
      >
        {/* 삭제 버튼 */}
        <button
          onClick={(e) => { e.stopPropagation(); if (!window.confirm('배송을 삭제하시겠습니까?')) return; onDelete(delivery) }}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center text-xs transition-colors shadow-sm"
        >×</button>

        {/* 고품 배지 */}
        {isGopoumCard && (
          <div className={`absolute -top-2 -left-2 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm leading-none whitespace-nowrap ${
            collectedByMe ? 'bg-green-500' : 'bg-amber-400'
          }`}>
            고품 {collectedCount}/{total}
          </div>
        )}

        <p className="font-semibold text-sm truncate text-slate-800">{delivery.client_name}</p>

        <div className="mt-1 flex items-center gap-2 text-xs whitespace-nowrap">
          {delivery.status === 'waiting' ? (
            <span className="font-medium text-amber-600">대기 <ElapsedTimer startIso={delivery.created_at} /></span>
          ) : (
            <span className="font-medium text-blue-600">배송 {assignedTime}</span>
          )}
        </div>
      </div>

      {showModal && gopoumItems && (
        <GopoumModal
          items={gopoumItems}
          deliveryId={delivery.id}
          onCollect={handleCollect}
          onUncollect={handleUncollect}
          onSetQuantity={handleSetQuantity}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
