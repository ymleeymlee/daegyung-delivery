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
  // 배정된 카드 취소 → 대기열로 복귀. assigned 카드에서만 노출.
  onUnassign?: (delivery: Delivery) => void
  // 배송 시각(departed/arrived/returned) 개별 수동 처리. 카드 안의 각 줄 옆
  // '수동 처리' 버튼에서 호출. DeliveryBoard 에서 field 별 patch 분기.
  onSetTimestamp?: (delivery: Delivery, field: 'departed' | 'arrived' | 'returned') => void
  gopoumItems?: GopoumItem[]
  gopoumClientId?: string
  riderName?: string
  // 이 배송(라이더)의 수거량을 quantity로 설정 (0이면 미수거)
  onSetPickup?: (itemId: string, deliveryId: string, riderName: string, quantity: number) => void
  // 배송 비고 저장 (빈 문자열이면 null로 저장)
  onSetNote?: (deliveryId: string, note: string) => void
}

// 배송카드 4단계 진행 표시 (2줄, 4컬럼) — 카드 생성 › 배송 출발 › 배송 완료 › 본사 복귀.
// 각 컬럼: 위(라벨) / 아래(hh:mm 값 or '진행중' 버튼 or '--:--').
function TimestampCell({
  label, time, onManual, accent,
}: {
  label: string
  time: string | null
  onManual?: () => void
  accent?: string
}) {
  return (
    <div className="flex flex-col items-center min-w-0 flex-1">
      <span className="text-slate-400 leading-tight">{label}</span>
      {time ? (
        <span className={`${accent ?? 'text-slate-600'} leading-tight tabular-nums`}>{time}</span>
      ) : onManual ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onManual() }}
          className="mt-0.5 px-1 py-0.5 rounded border border-slate-300 text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors leading-none text-[9px]"
        >
          진행중
        </button>
      ) : (
        <span className="text-slate-300 leading-tight tabular-nums">--:--</span>
      )}
    </div>
  )
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
            const max = maxForMe(item)
            const picked = val > 0
            const remain = qty(item) - collectedTotal(item)  // 아무도 아직 안 수거한 개수
            return (
              <div key={item.id}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${
                  picked ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-200'
                }`}>
                <div className="flex-1 min-w-0">
                  <div>
                    <span className={`text-sm font-medium ${picked ? 'text-green-700' : 'text-amber-800'}`}>{item.description}</span>
                    <span className="text-xs text-slate-400 ml-2 whitespace-nowrap">잔여 {remain}</span>
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
  delivery, isSelected, hasSelection, onSelect, onDelete, onUnassign, onSetTimestamp,
  gopoumItems, gopoumClientId, riderName, onSetPickup, onSetNote,
}: Props) {
  const [showModal, setShowModal] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const isCompleted = delivery.status === 'completed'
  // 완료 섹션으로 내려간 카드(status=completed && returned_at 있음) 만 접힘 대상.
  // 배송완료됐지만 아직 본사복귀 안 한 카드는 진행중 리스트에 남아 항상 펼쳐 놓는다.
  const isFullyDone = isCompleted && !!delivery.returned_at
  const note = delivery.note ?? ''

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

  const hhmm = (iso?: string | null) =>
    iso ? new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso)) : null
  const createdTime = hhmm(delivery.created_at)
  const departedTime = hhmm(delivery.departed_at)
  const arrivedTime = hhmm(delivery.arrived_at)
  const returnedTime = hhmm(delivery.returned_at)

  function askSetTimestamp(field: 'departed' | 'arrived' | 'returned') {
    if (!onSetTimestamp) return
    const label = field === 'departed' ? '배송 출발' : field === 'arrived' ? '배송 완료' : '본사 복귀'
    if (!window.confirm(`'${delivery.client_name}' ${label} 시각을 지금으로 기록하시겠습니까?`)) return
    onSetTimestamp(delivery, field)
  }

  function handleSetPickup(itemId: string, quantity: number) {
    if (onSetPickup) onSetPickup(itemId, delivery.id, riderName ?? '배송자', quantity)
  }

  // 카드 클릭:
  // - 완료 카드(선택 중 아님): 접기/펼치기 토글. 고품 편집은 고품 배지 클릭으로 분리.
  // - 진행중 카드(선택 중 아님, 고품 있음): 카드 자체가 고품 입력 버튼.
  // - 그 외(대기열 / 선택 진행 중): 기존 선택·배정 로직.
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (isFullyDone && !hasSelection) {
      setExpanded(v => !v)
      return
    }
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
        {/* 우상단 액션 배지:
            - waiting: × (삭제, 완전 제거)
            - assigned: '취소' (대기열로 되돌리기)
            - completed: 없음 (이미 완료된 배송) */}
        {delivery.status === 'waiting' && (
          <button
            onClick={(e) => { e.stopPropagation(); if (!window.confirm('배송을 삭제하시겠습니까?')) return; onDelete(delivery) }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center text-xs transition-colors shadow-sm"
            title="삭제"
          >×</button>
        )}
        {delivery.status === 'assigned' && onUnassign && (
          <button
            onClick={(e) => { e.stopPropagation(); if (!window.confirm(`'${delivery.client_name}' 배송을 취소하고 대기열로 되돌리시겠습니까?`)) return; onUnassign(delivery) }}
            className="absolute -top-2 -right-2 bg-white border border-amber-400 text-amber-700 hover:bg-amber-50 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm transition-colors"
            title="배정 취소 (대기열로 되돌리기)"
          >취소</button>
        )}

        {/* 배지 라인: 고품 + 메모. 완료 카드는 카드 클릭이 접기 토글이므로 고품 배지가 편집 트리거. */}
        <div className="absolute -top-2 -left-2 flex items-center gap-1">
          {isGopoumCard && (
            <button
              type="button"
              onClick={(e) => { if (!isCompleted) return; e.stopPropagation(); if (!hasSelection) setShowModal(true) }}
              disabled={!isCompleted}
              className={`text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm leading-none whitespace-nowrap transition-transform ${
                collectedByMe ? 'bg-orange-600' : 'bg-orange-400'
              } ${isCompleted ? 'cursor-pointer hover:scale-105' : ''}`}
              title={isCompleted ? '고품 수정' : undefined}
            >
              고품 {collectedCount}/{total}
            </button>
          )}
          {note && (
            <span
              className="bg-yellow-400 text-yellow-900 text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm leading-none whitespace-nowrap"
              title={note}
            >
              메모
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <p className={`font-semibold text-sm truncate flex-1 ${isCompleted ? 'text-slate-500' : 'text-slate-800'}`}>{delivery.client_name}</p>
          {isFullyDone && (
            <span className="text-slate-400 text-[10px] leading-none flex-shrink-0" aria-hidden="true">
              {expanded ? '▼' : '▶'}
            </span>
          )}
        </div>

        {delivery.status === 'waiting' ? (
          <div className="mt-1 text-xs whitespace-nowrap">
            <span className="font-medium text-amber-600">대기 <ElapsedTimer startIso={delivery.created_at} /></span>
          </div>
        ) : (!isFullyDone || expanded) && (
          <div className="mt-1.5 flex items-stretch text-[10px] whitespace-nowrap">
            {/* 4단계 (라벨/값 2줄), 컬럼 사이 › 화살표. '진행중' 버튼은 이전 단계가 완료되고
                 이 단계가 아직 안 됐을 때만 노출. */}
            <TimestampCell label="카드생성" time={createdTime} />
            <span className="flex items-center px-0.5 text-slate-300">›</span>
            <TimestampCell
              label="배송출발"
              time={departedTime}
              onManual={onSetTimestamp && !departedTime ? () => askSetTimestamp('departed') : undefined}
              accent={departedTime ? (isCompleted ? 'text-slate-500' : 'text-blue-600') : undefined}
            />
            <span className="flex items-center px-0.5 text-slate-300">›</span>
            <TimestampCell
              label="배송완료"
              time={arrivedTime}
              onManual={onSetTimestamp && !!departedTime && !arrivedTime ? () => askSetTimestamp('arrived') : undefined}
              accent={arrivedTime ? (isCompleted ? 'text-slate-500' : 'text-emerald-600 font-semibold') : undefined}
            />
            <span className="flex items-center px-0.5 text-slate-300">›</span>
            <TimestampCell
              label="본사복귀"
              time={returnedTime}
              onManual={onSetTimestamp && !!arrivedTime && !returnedTime ? () => askSetTimestamp('returned') : undefined}
            />
          </div>
        )}

        {/* 메모 인라인 편집 (팝업 없이 바로 입력). uncontrolled input — 한글 IME 조합 안전.
             완료 카드는 펼쳤을 때만 편집 UI 노출. */}
        {onSetNote && (!isFullyDone || expanded) && (
          <div className="mt-2 flex items-center gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
            <span className="text-slate-500 whitespace-nowrap">메모:</span>
            <input
              key={note}
              defaultValue={note}
              onBlur={(e) => {
                const next = e.target.value
                if (next !== note) onSetNote(delivery.id, next)
              }}
              onKeyDown={(e) => {
                const el = e.target as HTMLInputElement
                if (e.key === 'Enter') { e.preventDefault(); el.blur() }
                else if (e.key === 'Escape') { el.value = note; el.blur() }
              }}
              placeholder="메모 입력"
              className={`flex-1 min-w-0 border-b outline-none bg-transparent text-slate-700 focus:border-yellow-400 ${
                note ? 'border-yellow-300' : 'border-slate-200'
              }`}
            />
          </div>
        )}

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
