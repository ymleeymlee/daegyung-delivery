'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Branch } from '@/types'

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [newCode, setNewCode] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newSortOrder, setNewSortOrder] = useState(0)
  const [adding, setAdding] = useState(false)
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editSortOrder, setEditSortOrder] = useState(0)

  const fetchAll = useCallback(async () => {
    const { data } = await supabase.from('branches').select('*').order('sort_order')
    setBranches((data ?? []) as Branch[])
  }, [])

  useEffect(() => {
    fetchAll().finally(() => setLoading(false))
    const channel = supabase
      .channel('branches-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, fetchAll)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchAll])

  async function handleAdd() {
    const code = newCode.trim()
    const label = newLabel.trim()
    if (!code || !label || adding) return
    setAdding(true)
    const { error } = await supabase.from('branches').insert({ code, label, sort_order: newSortOrder })
    setAdding(false)
    if (!error) {
      setNewCode(''); setNewLabel(''); setNewSortOrder(0)
      fetchAll()
    } else {
      alert('추가 실패: ' + error.message)
    }
  }

  function startEdit(b: Branch) {
    setEditingCode(b.code)
    setEditLabel(b.label)
    setEditSortOrder(b.sort_order)
  }

  async function handleUpdate(code: string) {
    const label = editLabel.trim()
    if (!label) return
    const { error } = await supabase.from('branches').update({ label, sort_order: editSortOrder }).eq('code', code)
    if (error) { alert('수정 실패: ' + error.message); return }
    setEditingCode(null)
    fetchAll()
  }

  async function saveTime(code: string, field: 'open_time' | 'close_time', value: string) {
    const { error } = await supabase.from('branches').update({ [field]: value || null }).eq('code', code)
    if (error) alert('저장 실패: ' + error.message)
    else fetchAll()
  }

  // RLS 없이 앱 레벨에서 삭제 방지: clients/riders/deliveries 에서 이 지점을 사용 중이면 삭제 차단
  async function handleDelete(b: Branch) {
    if (!confirm(`지점 '${b.label}'(${b.code})을 삭제할까요?`)) return
    const [{ count: clientCount }, { count: riderCount }, { count: deliveryCount }] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('branch', b.code),
      supabase.from('riders').select('id', { count: 'exact', head: true }).eq('location', b.code),
      supabase.from('deliveries').select('id', { count: 'exact', head: true }).eq('branch', b.code),
    ])
    const total = (clientCount ?? 0) + (riderCount ?? 0) + (deliveryCount ?? 0)
    if (total > 0) {
      alert(
        `이 지점을 사용 중인 데이터가 있어 삭제할 수 없습니다.\n` +
        `거래처 ${clientCount ?? 0}개 · 라이더 ${riderCount ?? 0}명 · 배송 ${deliveryCount ?? 0}건`
      )
      return
    }
    const { error } = await supabase.from('branches').delete().eq('code', b.code)
    if (error) { alert('삭제 실패: ' + error.message); return }
    fetchAll()
  }

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-6">지점 관리</h1>

      {/* 추가 폼 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-6 flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-xs text-slate-500 block mb-1">코드 *</label>
          <input
            value={newCode}
            onChange={e => setNewCode(e.target.value.trim())}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="예) bs"
            className={`${inputCls} w-24`}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">지점명 *</label>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="예) 부산"
            className={`${inputCls} w-32`}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">정렬순서</label>
          <input
            type="number"
            value={newSortOrder}
            onChange={e => setNewSortOrder(parseInt(e.target.value) || 0)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            className={`${inputCls} w-20`}
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newCode.trim() || !newLabel.trim() || adding}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-xl transition-colors disabled:opacity-40"
        >
          {adding ? '추가 중...' : '+ 추가'}
        </button>
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <th className="text-left px-4 py-3 font-semibold w-24">코드</th>
              <th className="text-left px-4 py-3 font-semibold">지점명</th>
              <th className="text-left px-4 py-3 font-semibold w-28">정렬순서</th>
              <th className="px-4 py-3 w-32"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">불러오는 중...</td></tr>
            ) : branches.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">지점이 없습니다.</td></tr>
            ) : branches.map(b => (
              <>
                <tr key={b.code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  {editingCode === b.code ? (
                    <>
                      <td className="px-4 py-3 text-slate-400">
                        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{b.code}</code>
                        <span className="text-[10px] text-slate-300 ml-1">(수정 불가)</span>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          autoFocus
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={editSortOrder}
                          onChange={e => setEditSortOrder(parseInt(e.target.value) || 0)}
                          className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => handleUpdate(b.code)} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700">저장</button>
                          <button onClick={() => setEditingCode(null)} className="text-xs text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-100">취소</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{b.code}</code>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{b.label}</td>
                      <td className="px-4 py-3 text-slate-500">{b.sort_order}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => startEdit(b)} className="text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">수정</button>
                          <button onClick={() => handleDelete(b)} className="text-xs text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">삭제</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
                {/* 운영시간 행 */}
                <tr key={`${b.code}-hours`} className="border-b border-slate-100 bg-slate-50/50">
                  <td colSpan={4} className="px-4 py-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-slate-500 font-medium whitespace-nowrap">운영시간</span>
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs text-slate-400">시작</label>
                        <input
                          type="time"
                          step="60"
                          defaultValue={b.open_time ?? ''}
                          onBlur={e => saveTime(b.code, 'open_time', e.target.value)}
                          className="border border-slate-200 rounded px-2 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs text-slate-400">종료</label>
                        <input
                          type="time"
                          step="60"
                          defaultValue={b.close_time ?? ''}
                          onBlur={e => saveTime(b.code, 'close_time', e.target.value)}
                          className="border border-slate-200 rounded px-2 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <span className="text-[11px] text-slate-400">운영시간 밖에는 앱 위치공유가 종료되고 배송카드 생성이 차단됩니다.</span>
                    </div>
                  </td>
                </tr>
              </>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-400">총 {branches.length}개 지점</div>
      </div>
    </div>
  )
}
