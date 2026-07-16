'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Rider, RiderDevice } from '@/types'

const LOC_LABEL: Record<string, string> = { gn: '강남', as: '안산' }

// 숫자만 뽑아 자동 하이픈: 01087000078 → 010-8700-0078
function formatPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length < 4) return d
  if (d.length < 7) return `${d.slice(0, 3)}-${d.slice(3)}`
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`  // 10자리(3-3-4)
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`                       // 11자리(3-4-4)
}

function fmtAgo(iso: string | null): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}

interface LiveDevice { device_id: string; updated_at: string }

export default function RidersPage() {
  const [riders, setRiders] = useState<Rider[]>([])
  const [devices, setDevices] = useState<RiderDevice[]>([])
  const [liveDevices, setLiveDevices] = useState<LiveDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState<'gn' | 'as'>('gn')
  const [isQuick, setIsQuick] = useState(false)
  const [adding, setAdding] = useState(false)

  const fetchAll = useCallback(async () => {
    const [{ data: r }, { data: d }, { data: loc }] = await Promise.all([
      supabase.from('riders').select('*').eq('is_active', true),
      supabase.from('rider_devices').select('*'),
      supabase.from('rider_locations').select('device_id,updated_at'),
    ])
    setRiders((r ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    setDevices((d ?? []) as RiderDevice[])
    setLiveDevices((loc ?? []) as LiveDevice[])
  }, [])

  useEffect(() => { fetchAll().finally(() => setLoading(false)) }, [fetchAll])

  // 라이더별 매핑된 기기, 지정된 기기 집합
  const deviceOfRider = new Map<string, string>()
  for (const d of devices) if (d.rider_id) deviceOfRider.set(d.rider_id, d.device_id)
  const assignedIds = new Set(devices.filter(d => d.rider_id).map(d => d.device_id))

  // 감지됐지만 아직 라이더에 안 붙은 기기 (실시간 전송 중 + rider_devices 의 미지정 행)
  const lastSeen = new Map<string, string | null>()
  for (const l of liveDevices) lastSeen.set(l.device_id, l.updated_at)
  for (const d of devices) if (!lastSeen.has(d.device_id)) lastSeen.set(d.device_id, d.last_seen_at)
  const unassignedDevices = [...lastSeen.keys()].filter(id => !assignedIds.has(id))

  // 기기 ↔ 라이더 지정/해제 (한 라이더 = 한 기기: 지정 시 이전 기기는 해제)
  async function assign(deviceId: string, riderId: string | null) {
    if (riderId) {
      await supabase.from('rider_devices').update({ rider_id: null }).eq('rider_id', riderId).neq('device_id', deviceId)
    }
    const { error } = await supabase.from('rider_devices').upsert({ device_id: deviceId, rider_id: riderId })
    if (error) alert('기기 지정 실패: ' + error.message)
    fetchAll()
  }

  function assignManual(rider: Rider) {
    const input = window.prompt(`'${rider.name}'에 지정할 기기 ID를 입력하세요.\n(라이더 앱 알림에 표시된 코드)`)
    const id = input?.trim()
    if (id) assign(id, rider.id)
  }

  async function handleAdd() {
    if (!name.trim() || adding) return
    setAdding(true)
    const { error } = await supabase.from('riders').insert({
      name: name.trim(), phone: phone.trim() || null, location, is_quick: isQuick, is_active: true,
    })
    setAdding(false)
    if (!error) {
      setName(''); setPhone(''); setLocation('gn'); setIsQuick(false)
      fetchAll()
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
    if (error) fetchAll()
  }

  async function handleDelete(r: Rider) {
    if (!confirm(`라이더 '${r.name}'를 삭제할까요?`)) return
    setRiders(prev => prev.filter(x => x.id !== r.id))
    const { error } = await supabase.from('riders').delete().eq('id', r.id)
    if (error) fetchAll()
  }

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="p-6 max-w-3xl mx-auto">
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
              <th className="text-left px-4 py-3 font-semibold w-20">지점</th>
              <th className="text-left px-4 py-3 font-semibold">기기 ID</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">불러오는 중...</td></tr>
            ) : riders.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">라이더가 없습니다.</td></tr>
            ) : riders.map(r => {
              const mapped = deviceOfRider.get(r.id)
              return (
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
                <td className="px-4 py-3">
                  {mapped ? (
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded" title={mapped}>{mapped.slice(0, 8)}</code>
                      <button onClick={() => assign(mapped, null)} className="text-xs text-slate-400 hover:text-red-600">해제</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select
                        value=""
                        onChange={e => { if (e.target.value) assign(e.target.value, r.id) }}
                        className="border border-slate-200 rounded-md px-1.5 py-1 text-xs text-slate-600 bg-white max-w-[10rem]"
                      >
                        <option value="">기기 선택…</option>
                        {unassignedDevices.map(id => (
                          <option key={id} value={id}>{id.slice(0, 8)} · {fmtAgo(lastSeen.get(id) ?? null) || '기록'}</option>
                        ))}
                      </select>
                      <button onClick={() => assignManual(r)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">직접 입력</button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(r)} className="text-xs text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">삭제</button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-400">총 {riders.length}명</div>
      </div>

      {/* 미지정(감지된) 기기 안내 */}
      {!loading && unassignedDevices.length > 0 && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            미지정 기기 {unassignedDevices.length}대 — 위 목록에서 라이더에 지정하세요
          </p>
          <ul className="flex flex-wrap gap-2">
            {unassignedDevices.map(id => (
              <li key={id} className="text-xs bg-white border border-amber-200 rounded-lg px-2 py-1 text-slate-600">
                <code>{id.slice(0, 8)}</code>
                <span className="text-slate-400 ml-1.5">{fmtAgo(lastSeen.get(id) ?? null)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-700 mt-2">기기 ID는 라이더 폰의 위치 전송 알림에 표시됩니다.</p>
        </div>
      )}
    </div>
  )
}
