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
  // 이 배송(라이더)의 수거량을 quantity로 설정 (0이면 미수거)
  onSetPickup?: (itemId: string, deliveryId: string, riderName: string, quantity: number) => void
}

const qty = (i: GopoumItem) => i.quantity ?? 1
const itemCollectors = (i: GopoumItem) => i.collectors ?? []
const collectedTotal = (i: GopoumItem) => itemCollectors(i).reduce((s, c) => s + c.quantity, 0)
const myPickup = (i: GopoumItem, deliveryId: string) => itemCollectors(i).find(c => c.delivery_id === deliveryId)?.quantity ?? 0
const isFull = (i: GopoumItem) => collectedTotal(i) > 0 && collectedTotal(i) >= qty(i)  // 완전수거 여부(수량 기준)

function GopoumModal({
  items,
  deliveryId,
  onSetPickup,
  onClose,
}: {
  items: GopoumItem[]
  deliveryId: string
  onSetPickup: (itemId: string, quantity: number) => void
  onClose: () => void
}) {
  // 생성 순서(고품현황 추가 순)로 고정
  const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))

  // 열 때의 내 수거량 — 닫을 때 변경분만 커밋
  const initialMine = useMemo(() => {
    const m: Record<string, number> = {}
    for (const i of items) m[i.id] = myPickup(i, deliveryId)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 로컬 상태(내 수거량). 증감은 여기만 바뀌고 DB 통신은 닫을 때 → 깜빡임 없음
  const [mine, setMine] = useState<Record<string, number>>(initialMine)

  const othersQty = (i: GopoumItem) => collectedTotal(i) - myPickup(i, deliveryId)  // 다른 배송자가 수거한 양
  const maxForMe = (i: GopoumItem) => Math.max(0, qty(i) - othersQty(i))             // 내가 넣을 수 있는 최대(총량 초과 불가)
  const myVal = (i: GopoumItem) => mine[i.id] ?? 0

  // 헤더 = 현재까지 수거 수량 합 / 총 수량 합
  const total = sorted.reduce((s, i) => s + qty(i), 0)
  const collectedNow = sorted.reduce((s, i) => s + othersQty(i) + myVal(i), 0)

  function change(i: GopoumItem, delta: number) {
    setMine(p => ({ ...p, [i.id]: Math.min(maxForMe(i), Math.max(0, (p[i.id] ?? 0) + delta)) }))
  }

  // 닫을 때 변경분(내 수거량)을 한 번에 커밋
  function commitAndClose() {
    for (const i of items) {
      const v = mine[i.id] ?? 0
      if (v !== initialMine[i.id]) onSetPickup(i.id, v)
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
          {/* 각 품목: 내 수거량 −/+ (0이면 미수거·노랑, >0이면 수거·초록). 총량 초과 불가 */}
          {sorted.map(item => {
            const val = myVal(item)
            const others = othersQty(item)
            const max = maxForMe(item)
            const picked = val > 0
            return (
              <div key={item.id}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                  picked ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-200'
                }`}>
                <div className="flex-1 min-w-0">
                  <div>
                    <span className={`text-sm font-medium ${picked ? 'text-green-700' : 'text-amber-800'}`}>{item.description}</span>
                    <span className="text-xs text-slate-400 ml-2 whitespace-nowrap">총 {qty(item)}{others > 0 ? ` · 타 ${others}` : ''}</span>
                  </div>
                  {item.note && (
                    <div className="mt-1.5 text-xs text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-1 break-words">
                      <span className="text-slate-400 mr-1">비고</span>{item.note}
                    </div>
                  )}
                </div>
                {/* 내 수거량 −/값/+ */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => change(item, -1)} disabled={val <= 0}
                    className="w-7 h-7 rounded-md bg-white border border-slate-200 text-slate-600 text-base leading-none flex items-center justify-center hover:bg-slate-100 disabled:opacity-30">−</button>
                  <span className={`w-6 text-center text-sm font-bold ${picked ? 'text-green-600' : 'text-slate-400'}`}>{val}</span>
                  <button onClick={() => change(item, 1)} disabled={val >= max}
                    className="w-7 h-7 rounded-md bg-white border border-slate-200 text-slate-600 text-base leading-none flex items-center justify-center hover:bg-slate-100 disabled:opacity-30">+</button>
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
  gopoumItems, gopoumClientId, riderName, onSetPickup,
}: Props) {
  const [showModal, setShowModal] = useState(false)
  const isCompleted = delivery.status === 'completed'

  // 카드 생성 당시 스냅샷 품목 (getGopoumData가 생성 시점 기준으로 넘겨줌). 수량 합산 기준
  const gItems = gopoumItems ?? []
  const total = gItems.reduce((s, i) => s + qty(i), 0)                            // 총수량 합
  const collectedCount = gItems.reduce((s, i) => s + collectedTotal(i), 0)        // 수거된 수량 합 (누구든)
  const myCount = gItems.reduce((s, i) => s + myPickup(i, delivery.id), 0)        // 내가 수거한 수량 합
  // 카드 생성 당시 "찾을 고품"이 있었는지 = 생성 시점에 미수거였던 품목이 하나라도 있었는지.
  // 없으면(전부 이미 수거됐거나 품목 자체가 없음) 이 카드엔 고품 표시 안 함.
  // 판정은 실제 수거량 기준(isFull) — 완전수거 후 수량을 늘리면 다시 미완료가 되어 이 카드도 고품으로 잡힘.
  const hadGopoumAtCreation = gItems.some(i => !isFull(i) || (i.picked_at != null && i.picked_at > delivery.created_at))
  const hasGopoum = hadGopoumAtCreation
  const isGopoumCard = hasGopoum
  const collectedByMe = myCount > 0                              // 내가 하나라도 수거했으면 초록

  const assignedTime = delivery.assigned_at
    ? new Date(delivery.assigned_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null
  const arrivedTime = delivery.arrived_at
    ? new Date(delivery.arrived_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null

  function handleSetPickup(itemId: string, quantity: number) {
    if (onSetPickup) onSetPickup(itemId, delivery.id, riderName ?? '배송자', quantity)
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
          isCompleted
            ? 'bg-slate-100 border-slate-300'
            : isGopoumCard
              ? isSelected ? 'bg-amber-50 border-blue-500 ring-2 ring-blue-500' : 'bg-amber-50 border-amber-300 hover:border-amber-400'
              : isSelected ? 'bg-white border-blue-500 ring-2 ring-blue-500' : 'bg-white border-slate-200 hover:border-slate-300'
        }`}
      >
        {/* 삭제 버튼 (완료 카드는 실수 삭제 방지 위해 숨김 — 마감 때 시트 기록됨) */}
        {!isCompleted && (
          <button
            onClick={(e) => { e.stopPropagation(); if (!window.confirm('배송을 삭제하시겠습니까?')) return; onDelete(delivery) }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center text-xs transition-colors shadow-sm"
          >×</button>
        )}

        {/* 고품 배지 */}
        {isGopoumCard && (
          <div className={`absolute -top-2 -left-2 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm leading-none whitespace-nowrap ${
            collectedByMe ? 'bg-green-500' : 'bg-amber-400'
          }`}>
            고품 {collectedCount}/{total}
          </div>
        )}

        <p className={`font-semibold text-sm truncate ${isCompleted ? 'text-slate-500' : 'text-slate-800'}`}>{delivery.client_name}</p>

        <div className="mt-1 flex items-center gap-2 text-xs whitespace-nowrap">
          {delivery.status === 'waiting' ? (
            <span className="font-medium text-amber-600">대기 <ElapsedTimer startIso={delivery.created_at} /></span>
          ) : isCompleted ? (
            <span className="font-bold text-slate-500">✓ 완료</span>
          ) : (
            <span className="font-medium text-blue-600">배송 {assignedTime}</span>
          )}
          {arrivedTime && (
            <span className={`font-semibold ${isCompleted ? 'text-slate-400' : 'text-emerald-600'}`}>도착 {arrivedTime}</span>
          )}
        </div>
      </div>

      {showModal && gopoumItems && (
        <GopoumModal
          items={gopoumItems}
          deliveryId={delivery.id}
          onSetPickup={handleSetPickup}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
