'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Rider } from '@/types'

const LOC_LABEL: Record<string, string> = { gn: '강남', as: '안산' }

// 숫자만 뽑아 자동 하이픈: 01087000078 → 010-8700-0078
function formatPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length < 4) return d
  if (d.length < 7) return `${d.slice(0, 3)}-${d.slice(3)}`
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`  // 10자리(3-3-4)
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`                       // 11자리(3-4-4)
}

export default function RidersPage() {
  const [riders, setRiders] = useState<Rider[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState<'gn' | 'as'>('gn')
  const [isQuick, setIsQuick] = useState(false)
  const [adding, setAdding] = useState(false)

  const fetchRiders = useCallback(async () => {
    const { data } = await supabase.from('riders').select('*').eq('is_active', true)
    // 이름순 정렬
    const sorted = (data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    setRiders(sorted)
  }, [])

  useEffect(() => { fetchRiders().finally(() => setLoading(false)) }, [fetchRiders])

  async function handleAdd() {
    if (!name.trim() || adding) return
    setAdding(true)
    const { error } = await supabase.from('riders').insert({
      name: name.trim(), phone: phone.trim() || null, location, is_quick: isQuick, is_active: true,
    })
    setAdding(false)
    if (!error) {
      setName(''); setPhone(''); setLocation('gn'); setIsQuick(false)
      fetchRiders()
    } else {
      alert('추가 실패: ' + error.message)
    }
  }

  // 기존 라이더 전화번호 인라인 편집: 입력 중 자동 포맷(로컬), 포커스 아웃 시 저장
  function handlePhoneEdit(id: string, raw: string) {
    const formatted = formatPhone(raw)
    setRiders(prev => prev.map(r => r.id === id ? { ...r, phone: formatted } : r))
  }
  async function handlePhoneCommit(id: string, raw: string) {
    const formatted = formatPhone(raw)
    const { error } = await supabase.from('riders').update({ phone: formatted || null }).eq('id', id)
    if (error) fetchRiders()
  }

  async function handleDelete(r: Rider) {
    if (!confirm(`라이더 '${r.name}'를 삭제할까요?`)) return
    setRiders(prev => prev.filter(x => x.id !== r.id))
    const { error } = await supabase.from('riders').delete().eq('id', r.id)
    if (error) fetchRiders()
  }

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-6">라이더 관리</h1>

      {/* 추가 폼 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-6 flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-xs text-slate-500 block mb-1">이름 *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="라이더 이름"
            className={`${inputCls} w-36`}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">전화번호</label>
          <input
            value={phone}
            onChange={e => setPhone(formatPhone(e.target.value))}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            placeholder="010-0000-0000"
            inputMode="numeric"
            className={`${inputCls} w-40`}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">지점</label>
          <select value={location} onChange={e => setLocation(e.target.value as 'gn' | 'as')} className={inputCls}>
            <option value="gn">강남</option>
            <option value="as">안산</option>
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 pb-1.5">
          <input type="checkbox" checked={isQuick} onChange={e => setIsQuick(e.target.checked)} className="w-4 h-4" />
          퀵 구역
        </label>
        <button
          onClick={handleAdd}
          disabled={!name.trim() || adding}
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
              <th className="text-left px-4 py-3 font-semibold">이름</th>
              <th className="text-left px-4 py-3 font-semibold w-40">전화번호</th>
              <th className="text-left px-4 py-3 font-semibold w-24">지점</th>
              <th className="text-left px-4 py-3 font-semibold w-20">퀵</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">불러오는 중...</td></tr>
            ) : riders.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">라이더가 없습니다.</td></tr>
            ) : riders.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-3">
                  <input
                    value={r.phone ?? ''}
                    onChange={e => handlePhoneEdit(r.id, e.target.value)}
                    onBlur={e => handlePhoneCommit(r.id, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    placeholder="010-0000-0000"
                    inputMode="numeric"
                    className="w-36 border border-transparent hover:border-slate-200 focus:border-blue-400 rounded-md px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-slate-300"
                  />
                </td>
                <td className="px-4 py-3 text-slate-600">{LOC_LABEL[r.location ?? 'gn']}</td>
                <td className="px-4 py-3">{r.is_quick ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">퀵</span> : ''}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(r)} className="text-xs text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-400">총 {riders.length}명</div>
      </div>
    </div>
  )
}
