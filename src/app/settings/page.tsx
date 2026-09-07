'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AppState, fetchAppState, effNow, kstNowHm } from '@/lib/appState'
import { AUTO_ACTION_ITEMS, AutoActionKey, AutoActionsMap, defaultAutoActions, fetchAutoActions, saveAutoActions } from '@/lib/autoActions'
import { Branch } from '@/types'

// 설정 페이지: 톱니 버튼으로 진입. 관리자 비밀번호 게이트 뒤에 표시.
// - 시트 업데이트
// - 관리자 비밀번호 변경
// - 지점 관리 (추가/편집/삭제 + 마감시간)
export default function SettingsPage() {
  // 언마운트(설정 페이지를 나가면) 자동 초기화 → 재진입 시 비번 재입력 필요
  const [unlocked, setUnlocked] = useState(false)
  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />
  return <SettingsContent />
}

// === 비밀번호 유틸 ===
const ADMIN_KEY = 'admin_password'
const DEFAULT_PW = '1234'

async function fetchAdminPassword(): Promise<string> {
  const { data } = await supabase.from('app_state').select('value').eq('key', ADMIN_KEY).maybeSingle()
  const v = (data as { value?: string } | null)?.value
  if (v) return v
  // 최초 접근: 기본값 1234 로 초기화
  await supabase.from('app_state').upsert({ key: ADMIN_KEY, value: DEFAULT_PW })
  return DEFAULT_PW
}

async function setAdminPassword(newPw: string) {
  const { error } = await supabase.from('app_state').upsert({ key: ADMIN_KEY, value: newPw })
  if (error) throw error
}

// === 비밀번호 게이트 ===
function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [defaultWarn, setDefaultWarn] = useState(false)

  // 첫 진입 시 기본 비번 존재 여부만 미리 확인해서 경고 문구 노출
  useEffect(() => {
    (async () => {
      const p = await fetchAdminPassword()
      if (p === DEFAULT_PW) setDefaultWarn(true)
    })()
  }, [])

  async function submit() {
    if (busy || !pw) return
    setBusy(true); setMsg(null)
    try {
      const saved = await fetchAdminPassword()
      if (pw === saved) {
        onUnlock()
      } else {
        setMsg('비밀번호가 일치하지 않습니다.')
        setPw('')
      }
    } catch (e) {
      setMsg('비밀번호 확인 실패: ' + String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-800 mb-2">관리자 비밀번호</h1>
        <p className="text-xs text-slate-500 mb-4">설정 페이지에 접근하려면 관리자 비밀번호를 입력하세요.</p>
        {defaultWarn && (
          <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 mb-3">
            기본 비밀번호(<b>1234</b>)로 설정돼 있습니다. 로그인 후 바로 변경하세요.
          </div>
        )}
        <input
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="비밀번호"
          autoFocus
        />
        {msg && <p className="text-xs text-red-600 mt-2">{msg}</p>}
        <button
          onClick={submit}
          disabled={busy || !pw}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? '확인 중...' : '확인'}
        </button>
      </div>
    </div>
  )
}

// === 실제 설정 컨텐츠 ===
function SettingsContent() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [updateDone, setUpdateDone] = useState(false)
  const [state, setState] = useState<AppState>({ offset: 0, closedUntil: null, minAppVersion: null })
  const [pwOpen, setPwOpen] = useState(false)

  // 지점 편집 상태
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editSortOrder, setEditSortOrder] = useState(0)

  // 지점 추가 상태
  const [newCode, setNewCode] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newSortOrder, setNewSortOrder] = useState(0)
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => { setState(await fetchAppState()) }, [])
  const fetchBranches = useCallback(async () => {
    const { data } = await supabase.from('branches').select('*').order('sort_order')
    setBranches((data ?? []) as Branch[])
  }, [])

  useEffect(() => {
    Promise.all([refresh(), fetchBranches()]).finally(() => setLoading(false))
    const ch = supabase
      .channel('settings-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, fetchBranches)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [refresh, fetchBranches])

  // 23:55~24:00 은 자동 마감 준비시간 → 업데이트 비활성
  const kstHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(effNow(state.offset))
  const [bh, bm] = kstHM.split(':').map(Number)
  const blockWindow = bh === 23 && bm >= 55
  const nowHm = kstNowHm(state.offset)

  async function handleUpdate() {
    if (blockWindow) { alert('23:55~24:00 은 자동 마감 준비 시간이라 업데이트가 잠시 막힙니다.'); return }
    setUpdating(true)
    try {
      const res = await fetch('/api/update-sheets')
      const json = await res.json().catch(() => null) as { error?: string; updated?: string[] } | null
      if (res.ok) {
        setUpdateDone(true)
        setTimeout(() => setUpdateDone(false), 4000)
      } else {
        const done = json?.updated?.length ? `\n(성공: ${json.updated.join(', ')})` : ''
        alert('업데이트 실패: ' + (json?.error ?? res.statusText) + done)
      }
    } catch {
      alert('업데이트 실패')
    }
    setUpdating(false)
  }

  async function saveTime(code: string, field: 'open_time' | 'close_time', value: string) {
    const { error } = await supabase.from('branches').update({ [field]: value || null }).eq('code', code)
    if (error) alert('저장 실패: ' + error.message)
    else fetchBranches()
  }

  function startEdit(b: Branch) {
    setEditingCode(b.code); setEditLabel(b.label); setEditSortOrder(b.sort_order)
  }
  async function saveEdit(code: string) {
    const label = editLabel.trim()
    if (!label) return
    const { error } = await supabase.from('branches').update({ label, sort_order: editSortOrder }).eq('code', code)
    if (error) { alert('수정 실패: ' + error.message); return }
    setEditingCode(null); fetchBranches()
  }

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
    fetchBranches()
  }

  async function handleAdd() {
    const code = newCode.trim()
    const label = newLabel.trim()
    if (!code || !label || adding) return
    setAdding(true)
    const { error } = await supabase.from('branches').insert({ code, label, sort_order: newSortOrder })
    setAdding(false)
    if (error) { alert('추가 실패: ' + error.message); return }
    setNewCode(''); setNewLabel(''); setNewSortOrder(0)
    fetchBranches()
  }

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-slate-800">설정</h1>
        <button
          onClick={() => setPwOpen(true)}
          className="text-sm border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-xl transition-colors"
        >
          🔑 관리자 비밀번호 변경
        </button>
      </div>

      {/* 업데이트 카드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-slate-800">시트 업데이트</h2>
            <p className="text-xs text-slate-500 mt-1">현재 내용을 배송·고품·위치 시트에 덮어쓰기 (마감 아님 · 언제든 반복 가능)</p>
          </div>
          <div className="flex items-center gap-3">
            {updateDone && (
              <span className="text-sm font-semibold text-green-600 animate-pulse">✓ 업데이트됨</span>
            )}
            <button
              onClick={handleUpdate}
              disabled={updating || blockWindow}
              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {updating ? '업데이트 중...' : blockWindow ? '마감 준비중' : '업데이트'}
            </button>
          </div>
        </div>
      </section>

      {/* 지점 관리 카드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">지점 관리</h2>
        <p className="text-xs text-slate-500 mb-4">
          지점별 이름·정렬·운영시간을 편집하고 새 지점을 추가할 수 있습니다.
          운영시간 밖은 자동 마감 상태로 표시되어 앱 위치공유·배송카드 생성이 차단됩니다.
        </p>

        {loading ? (
          <div className="text-sm text-slate-400">로딩 중...</div>
        ) : branches.length === 0 ? (
          <div className="text-sm text-slate-400 mb-4">등록된 지점이 없습니다. 아래에서 추가하세요.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-200 whitespace-nowrap">
                <th className="text-left font-medium py-2 w-20">코드</th>
                <th className="text-left font-medium py-2 min-w-[6rem]">지점명</th>
                <th className="text-left font-medium py-2 w-16">정렬</th>
                <th className="text-left font-medium py-2 w-44">시작</th>
                <th className="text-left font-medium py-2 w-44">마감</th>
                <th className="text-left font-medium py-2 w-20">현재</th>
                <th className="text-right font-medium py-2 w-32">작업</th>
              </tr>
            </thead>
            <tbody>
              {branches.map(b => {
                const isBranchClosedNow = (() => {
                  if (!b.open_time || !b.close_time) return false
                  return nowHm < b.open_time || nowHm >= b.close_time
                })()
                const isEditing = editingCode === b.code
                return (
                  <tr key={b.code} className="border-b border-slate-100 last:border-0 align-middle">
                    <td className="py-3 text-slate-500 font-mono text-xs">{b.code}</td>
                    <td className="py-3">
                      {isEditing ? (
                        <input value={editLabel} onChange={e => setEditLabel(e.target.value)} className={`${inputCls} w-32`} />
                      ) : (
                        <span className="font-semibold text-slate-700">{b.label}</span>
                      )}
                    </td>
                    <td className="py-3">
                      {isEditing ? (
                        <input type="number" value={editSortOrder} onChange={e => setEditSortOrder(parseInt(e.target.value) || 0)} className={`${inputCls} w-14`} />
                      ) : (
                        <span className="text-slate-500 text-xs">{b.sort_order}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <input
                        type="time"
                        defaultValue={b.open_time ?? ''}
                        onBlur={e => saveTime(b.code, 'open_time', e.target.value)}
                        className={`${inputCls} w-full min-w-[10.5rem]`}
                      />
                    </td>
                    <td className="py-3">
                      <input
                        type="time"
                        defaultValue={b.close_time ?? ''}
                        onBlur={e => saveTime(b.code, 'close_time', e.target.value)}
                        className={`${inputCls} w-full min-w-[10.5rem]`}
                      />
                    </td>
                    <td className="py-3">
                      {b.open_time && b.close_time ? (
                        isBranchClosedNow ? (
                          <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">마감</span>
                        ) : (
                          <span className="text-xs font-medium text-green-600">영업중</span>
                        )
                      ) : (
                        <span className="text-xs text-slate-400">미지정</span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => saveEdit(b.code)} className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg">저장</button>
                          <button onClick={() => setEditingCode(null)} className="text-xs border border-slate-300 text-slate-500 hover:bg-slate-50 px-2.5 py-1 rounded-lg">취소</button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => startEdit(b)} className="text-xs border border-slate-300 text-slate-600 hover:bg-slate-50 px-2.5 py-1 rounded-lg">편집</button>
                          <button onClick={() => handleDelete(b)} className="text-xs border border-red-200 text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-lg">삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* 지점 추가 폼 */}
        <div className="mt-6 pt-4 border-t border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">지점 추가</h3>
          <div className="flex items-end gap-3 flex-wrap">
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
                className={`${inputCls} w-20`}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || !newCode || !newLabel}
              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {adding ? '추가 중...' : '지점 추가'}
            </button>
          </div>
        </div>
      </section>

      <AutoActionsSection />

      {pwOpen && <PasswordChangeModal onClose={() => setPwOpen(false)} />}
    </div>
  )
}

// === 자동 수행 설정 ===
function AutoActionsSection() {
  const [config, setConfig] = useState<AutoActionsMap>(defaultAutoActions())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<AutoActionKey | null>(null)

  useEffect(() => {
    (async () => {
      try { setConfig(await fetchAutoActions(supabase)) }
      finally { setLoading(false) }
    })()
  }, [])

  async function toggle(key: AutoActionKey, trigger: 'close' | 'midnight') {
    const next = { ...config, [key]: { ...config[key], [trigger]: !config[key][trigger] } }
    setConfig(next)
    setSaving(key)
    try {
      await saveAutoActions(supabase, next)
    } catch (e) {
      alert('저장 실패: ' + String(e))
      setConfig(config) // 롤백
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 mb-1">자동 수행 설정</h2>
      <p className="text-xs text-slate-500 mb-4">
        마감(매일 22:00 KST) · 다음날(00:00 이후 첫 접속) 시점에 자동 실행할 항목을 선택합니다.
        같은 항목을 두 시점 모두 켜면 두 번 실행됩니다 (대부분 무해). 둘 다 끄면 해당 시점에 실행되지 않습니다.
      </p>
      {loading ? (
        <div className="text-sm text-slate-400">로딩 중...</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-200">
              <th className="text-left font-medium py-2">항목</th>
              <th className="text-center font-medium py-2 w-24">마감<br /><span className="text-slate-400 font-normal">22:00 KST</span></th>
              <th className="text-center font-medium py-2 w-28">다음날<br /><span className="text-slate-400 font-normal">00시 이후</span></th>
            </tr>
          </thead>
          <tbody>
            {AUTO_ACTION_ITEMS.map(it => (
              <tr key={it.key} className="border-b border-slate-100 last:border-0 align-middle">
                <td className="py-3">
                  <div className="font-medium text-slate-700">{it.label}</div>
                  {it.hint && <div className="text-xs text-slate-400 mt-0.5">{it.hint}</div>}
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    checked={config[it.key].close}
                    disabled={saving === it.key}
                    onChange={() => toggle(it.key, 'close')}
                    className="w-4 h-4 cursor-pointer accent-blue-600"
                  />
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    checked={config[it.key].midnight}
                    disabled={saving === it.key}
                    onChange={() => toggle(it.key, 'midnight')}
                    className="w-4 h-4 cursor-pointer accent-blue-600"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-slate-400 mt-3">
        참고: 위치 공유 차단·배송 카드 생성 차단은 현재 같은 매커니즘(closed_until)을 씁니다.
        둘 중 하나라도 켜져 있으면 마감 상태로 진입합니다. 다음날 00시 트리거는 페이지 로드 시 하루 첫 회에만 실행됩니다.
      </p>
    </section>
  )
}

// === 비밀번호 변경 모달 ===
function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit() {
    if (busy) return
    if (!current || !next || !confirm) { setMsg('모든 항목을 입력하세요.'); return }
    if (next !== confirm) { setMsg('새 비밀번호가 일치하지 않습니다.'); return }
    if (next.length < 4) { setMsg('비밀번호는 4자 이상.'); return }
    setBusy(true); setMsg(null)
    try {
      const saved = await fetchAdminPassword()
      if (current !== saved) { setMsg('현재 비밀번호가 일치하지 않습니다.'); setBusy(false); return }
      await setAdminPassword(next)
      alert('비밀번호가 변경됐습니다.')
      onClose()
    } catch (e) {
      setMsg('변경 실패: ' + String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-800 mb-4">관리자 비밀번호 변경</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">현재 비밀번호</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">새 비밀번호</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">새 비밀번호 확인</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
        {msg && <p className="text-xs text-red-600 mt-3">{msg}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-semibold py-2.5 rounded-xl transition-colors">취소</button>
          <button onClick={submit} disabled={busy} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-40 transition-colors">
            {busy ? '변경 중...' : '변경'}
          </button>
        </div>
      </div>
    </div>
  )
}
