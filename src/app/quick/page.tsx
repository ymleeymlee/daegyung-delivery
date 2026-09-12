'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Rider } from '@/types'
import { useBranch } from '@/lib/branch'

// 퀵 관리 — 앱을 안 쓰는 외주 퀵 업체. 배송현황 라이더 카드 가장 오른쪽에 노출된다.
// riders 테이블에 is_quick=true 로 저장. 배정 로직은 기존 rider_id 기반과 동일.
export default function QuickPage() {
  const { branch } = useBranch()
  const [quicks, setQuicks] = useState<Rider[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('riders')
      .select('*')
      .eq('is_quick', true)
      .eq('location', branch)
      .order('created_at')
    setQuicks((data ?? []) as Rider[])
    setLoading(false)
  }, [branch])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel('quick-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, () => void load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function handleAdd() {
    const name = newName.trim()
    const phone = newPhone.trim() || null
    if (!name || adding) return
    setAdding(true)
    const { error } = await supabase.from('riders').insert({
      name, phone, is_quick: true, is_active: true, location: branch,
    })
    setAdding(false)
    if (error) { alert('추가 실패: ' + error.message); return }
    setNewName(''); setNewPhone('')
  }

  async function handleDelete(q: Rider) {
    if (!confirm(`퀵 '${q.name}'을 삭제할까요?`)) return
    const { count } = await supabase
      .from('deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('rider_id', q.id)
    if ((count ?? 0) > 0) {
      alert(`이 퀵에 배정된 배송이 ${count}건 있어 삭제할 수 없습니다. 먼저 배송을 정리하세요.`)
      return
    }
    const { error } = await supabase.from('riders').delete().eq('id', q.id)
    if (error) alert('삭제 실패: ' + error.message)
  }

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-800">퀵 관리</h1>
      <p className="text-xs text-slate-500">
        앱을 쓰지 않는 외주 퀵 업체. 추가하면 배송현황의 라이더 카드 가장 오른쪽에 나타나고 대기열 카드를 배정할 수 있습니다.
      </p>

      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        {loading ? (
          <div className="text-sm text-slate-400">로딩 중...</div>
        ) : quicks.length === 0 ? (
          <div className="text-sm text-slate-400">등록된 퀵이 없습니다. 아래에서 추가하세요.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-200 whitespace-nowrap">
                <th className="text-left font-medium py-2 min-w-[10rem]">이름</th>
                <th className="text-left font-medium py-2 w-48">전화번호</th>
                <th className="text-right font-medium py-2 w-24">작업</th>
              </tr>
            </thead>
            <tbody>
              {quicks.map(q => (
                <tr key={q.id} className="border-b border-slate-100 last:border-0 align-middle">
                  <td className="py-3 font-semibold text-slate-700">{q.name}</td>
                  <td className="py-3 text-slate-600">{q.phone ?? '-'}</td>
                  <td className="py-3 text-right">
                    <button onClick={() => handleDelete(q)} className="text-xs border border-red-200 text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-lg">삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">퀵 추가</h3>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-slate-500 block mb-1">이름 *</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
                placeholder="예) 안산퀵"
                className={`${inputCls} w-48`}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">전화번호</label>
              <input
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
                placeholder="예) 031-000-0000"
                className={`${inputCls} w-48`}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {adding ? '추가 중...' : '퀵 추가'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
