'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AppState, DEFAULT_BUSINESS_OPEN, DEFAULT_BUSINESS_CLOSE, DEFAULT_DELIVERY_RADIUS, fetchAppState, effNow, kstNowHm, isBusinessClosed } from '@/lib/appState'
import { AUTO_ACTION_ITEMS, AutoActionKey, AutoActionsMap, defaultAutoActions, fetchAutoActions, saveAutoActions } from '@/lib/autoActions'
import { Branch, Rider } from '@/types'

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
  const [state, setState] = useState<AppState>({ offset: 0, closedUntil: null, minAppVersion: null, businessOpen: DEFAULT_BUSINESS_OPEN, businessClose: DEFAULT_BUSINESS_CLOSE, deliveryRadius: DEFAULT_DELIVERY_RADIUS })
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

  async function saveBusinessTime(field: 'business_open_time' | 'business_close_time', value: string) {
    if (!value) return
    const { error } = await supabase.from('app_state').upsert({ key: field, value })
    if (error) { alert('저장 실패: ' + error.message); return }
    // 새 영업시간에 지금이 "영업중" 이면 자동마감(closed_until) 도 함께 해제.
    // 관리자가 영업시간을 앞당겨 재개하려는 의도로 판단.
    const newOpen = field === 'business_open_time' ? value : state.businessOpen
    const newClose = field === 'business_close_time' ? value : state.businessClose
    const nowHmNew = kstNowHm(state.offset)
    if (!isBusinessClosed(nowHmNew, newOpen, newClose)) {
      await supabase.from('app_state').upsert({ key: 'closed_until', value: '' })
    }
  }

  async function clearAutoClose() {
    if (!confirm('자동마감 상태를 지금 해제하시겠습니까?')) return
    const { error } = await supabase.from('app_state').upsert({ key: 'closed_until', value: '' })
    if (error) alert('해제 실패: ' + error.message)
  }

  async function saveDeliveryRadius(value: number) {
    const { error } = await supabase.from('app_state').upsert({ key: 'delivery_radius_m', value: String(value) })
    if (error) alert('저장 실패: ' + error.message)
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

      {/* 영업 시간 카드 (전역) */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">영업 시간</h2>
        <p className="text-xs text-slate-500 mb-4">
          전역 영업 시작·마감 시각. 자동 수행 &apos;마감&apos; 트리거는 여기 마감 시각 기준으로 동작합니다.
          영업시간 밖에는 마감 배지 표시 · 앱 위치공유 종료 · 배송 카드 생성 차단됩니다.
        </p>
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <label className="text-xs text-slate-500 block mb-1">시작</label>
            <input
              type="time"
              value={state.businessOpen}
              onChange={e => setState(s => ({ ...s, businessOpen: e.target.value }))}
              onBlur={e => saveBusinessTime('business_open_time', e.target.value)}
              className={`${inputCls} min-w-[10.5rem]`}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">마감</label>
            <input
              type="time"
              value={state.businessClose}
              onChange={e => setState(s => ({ ...s, businessClose: e.target.value }))}
              onBlur={e => saveBusinessTime('business_close_time', e.target.value)}
              className={`${inputCls} min-w-[10.5rem]`}
            />
          </div>
          <div className="mb-1.5 flex items-center gap-2">
            {isBusinessClosed(nowHm, state.businessOpen, state.businessClose) ? (
              <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">현재 마감</span>
            ) : (
              <span className="text-xs font-medium text-green-600">현재 영업중</span>
            )}
            {state.closedUntil && new Date(state.closedUntil).getTime() > effNow(state.offset).getTime() && (
              <button
                onClick={clearAutoClose}
                className="text-xs border border-slate-300 text-slate-600 hover:bg-slate-50 px-2 py-0.5 rounded-lg transition-colors"
                title="이전 자동마감으로 세팅된 closed_until 을 지금 즉시 해제"
              >
                자동마감 해제
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 배송지 도착 반경 카드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">배송지 도착 반경</h2>
        <p className="text-xs text-slate-500 mb-4">
          라이더가 배송지 좌표로부터 이 반경 안에 진입하면 &apos;배송완료&apos;가 자동 기록됩니다.
          앱이 30초 주기로 이 값을 읽어 반영합니다.
        </p>
        <div className="flex items-center gap-4">
          <input
            type="range" min={10} max={200} step={5}
            value={state.deliveryRadius}
            onChange={e => setState(s => ({ ...s, deliveryRadius: parseInt(e.target.value) }))}
            onMouseUp={e => saveDeliveryRadius(parseInt((e.target as HTMLInputElement).value))}
            onTouchEnd={e => saveDeliveryRadius(parseInt((e.target as HTMLInputElement).value))}
            onKeyUp={e => saveDeliveryRadius(parseInt((e.target as HTMLInputElement).value))}
            className="flex-1 max-w-md accent-blue-600"
          />
          <span className="text-sm font-mono text-slate-700 min-w-[3.5rem] text-right">{state.deliveryRadius}m</span>
        </div>
      </section>

      <AppReleaseSection />

      {/* 지점 관리 카드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-1">지점 관리</h2>
        <p className="text-xs text-slate-500 mb-4">
          지점명·정렬을 편집하고 새 지점을 추가할 수 있습니다. (영업시간은 위 카드에서 전역 관리)
        </p>

        {loading ? (
          <div className="text-sm text-slate-400">로딩 중...</div>
        ) : branches.length === 0 ? (
          <div className="text-sm text-slate-400 mb-4">등록된 지점이 없습니다. 아래에서 추가하세요.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-200 whitespace-nowrap">
                <th className="text-left font-medium py-2 w-24">코드</th>
                <th className="text-left font-medium py-2 min-w-[8rem]">지점명</th>
                <th className="text-left font-medium py-2 w-20">정렬</th>
                <th className="text-right font-medium py-2 w-40">작업</th>
              </tr>
            </thead>
            <tbody>
              {branches.map(b => {
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

      <QuickManageSection branches={branches} />

      <AutoActionsSection />

      {pwOpen && <PasswordChangeModal onClose={() => setPwOpen(false)} />}
    </div>
  )
}

// === 라이더 앱 배포 (인앱 자동 업데이트) ===
// 최신 버전/APK URL 은 웹에 배포된 /rider-app.json 을 읽어 Nav 에서 자동 동기화 (수동 입력 없음).
// 이 카드는 현재 값 확인 + 최소 버전(강제 게이팅) 만 관리.
function AppReleaseSection() {
  const [latestVersion, setLatestVersion] = useState('')
  const [apkUrl, setApkUrl] = useState('')
  const [minVersion, setMinVersion] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase.from('app_state').select('*').in('key', ['latest_app_version', 'latest_app_apk_url', 'min_app_version'])
    const m: Record<string, string> = {}
    for (const r of (data ?? []) as { key: string; value: string }[]) m[r.key] = r.value
    setLatestVersion(m.latest_app_version || '')
    setApkUrl(m.latest_app_apk_url || '')
    setMinVersion(m.min_app_version || '')
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel('app-release-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, () => void load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  async function saveMin(value: string) {
    const { error } = await supabase.from('app_state').upsert({ key: 'min_app_version', value })
    if (error) alert('저장 실패: ' + error.message)
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 mb-1">라이더 앱 배포</h2>
      <p className="text-xs text-slate-500 mb-4">
        <b>최신 버전 · APK URL</b> 은 웹 배포에 포함된 <code>/rider-app.json</code> 에서 자동 동기화됩니다 (수동 입력 없음).
        <br />
        APK 를 새로 빌드·배포하면 실행 중인 라이더 앱에 &quot;새 버전 있음&quot; 팝업이 뜹니다.
      </p>
      {loading ? (
        <div className="text-sm text-slate-400">로딩 중...</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs text-slate-500 mb-0.5">최신 버전 (자동)</div>
              <div className="font-mono text-slate-800">{latestVersion || <span className="text-slate-400 italic">미동기화</span>}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500 mb-0.5">APK URL (자동)</div>
              <div className="font-mono text-slate-600 text-xs truncate" title={apkUrl}>{apkUrl || <span className="text-slate-400 italic">미동기화</span>}</div>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <label className="block text-xs text-slate-500 mb-1">최소 버전 (강제 게이팅 · 미달이면 출근 차단)</label>
            <input
              type="text"
              value={minVersion}
              onChange={e => setMinVersion(e.target.value)}
              onBlur={e => saveMin(e.target.value.trim())}
              placeholder="1.10.0"
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-40 font-mono"
            />
          </div>
        </div>
      )}
    </section>
  )
}

// === 퀵 관리 ===
// 앱을 안 쓰는 외주 퀵 업체를 라이더 카드처럼 배송현황에 노출하기 위한 관리 UI.
// riders 테이블에 is_quick=true 로 저장. 배정 로직은 기존 rider_id 기반과 동일.
function QuickManageSection({ branches }: { branches: Branch[] }) {
  const [quicks, setQuicks] = useState<Rider[]>([])
  const [loading, setLoading] = useState(true)
  const [newBranch, setNewBranch] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('riders').select('*').eq('is_quick', true).order('location').order('created_at')
    setQuicks((data ?? []) as Rider[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel('quick-manage')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, () => void load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  useEffect(() => {
    if (!newBranch && branches.length > 0) setNewBranch(branches[0].code)
  }, [branches, newBranch])

  async function handleAdd() {
    const name = newName.trim()
    const phone = newPhone.trim() || null
    if (!newBranch || !name || adding) return
    setAdding(true)
    const { error } = await supabase.from('riders').insert({
      name, phone, is_quick: true, is_active: true, location: newBranch,
    })
    setAdding(false)
    if (error) { alert('추가 실패: ' + error.message); return }
    setNewName(''); setNewPhone('')
  }

  async function handleDelete(q: Rider) {
    if (!confirm(`퀵 '${q.name}'을 삭제할까요?`)) return
    const { count } = await supabase.from('deliveries').select('id', { count: 'exact', head: true }).eq('rider_id', q.id)
    if ((count ?? 0) > 0) {
      alert(`이 퀵에 배정된 배송이 ${count}건 있어 삭제할 수 없습니다. 먼저 배송을 정리하세요.`)
      return
    }
    const { error } = await supabase.from('riders').delete().eq('id', q.id)
    if (error) alert('삭제 실패: ' + error.message)
  }

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'
  const labelOf = (code: string) => branches.find(b => b.code === code)?.label ?? code

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800 mb-1">퀵 관리</h2>
      <p className="text-xs text-slate-500 mb-4">
        앱을 쓰지 않는 외주 퀵 업체. 추가하면 배송현황의 라이더 카드 가장 오른쪽에 나타나고 대기열 카드를 배정할 수 있습니다.
      </p>

      {loading ? (
        <div className="text-sm text-slate-400">로딩 중...</div>
      ) : quicks.length === 0 ? (
        <div className="text-sm text-slate-400 mb-4">등록된 퀵이 없습니다. 아래에서 추가하세요.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-200 whitespace-nowrap">
              <th className="text-left font-medium py-2 w-24">지점</th>
              <th className="text-left font-medium py-2 min-w-[8rem]">이름</th>
              <th className="text-left font-medium py-2 w-40">전화번호</th>
              <th className="text-right font-medium py-2 w-24">작업</th>
            </tr>
          </thead>
          <tbody>
            {quicks.map(q => (
              <tr key={q.id} className="border-b border-slate-100 last:border-0 align-middle">
                <td className="py-3 text-slate-500 text-xs">{labelOf(q.location)}</td>
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
            <label className="text-xs text-slate-500 block mb-1">지점 *</label>
            <select value={newBranch} onChange={e => setNewBranch(e.target.value)} className={`${inputCls} w-28`}>
              {branches.map(b => (<option key={b.code} value={b.code}>{b.label}</option>))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">이름 *</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="예) 안산퀵"
              className={`${inputCls} w-40`}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">전화번호</label>
            <input
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="예) 031-000-0000"
              className={`${inputCls} w-40`}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !newBranch || !newName}
            className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {adding ? '추가 중...' : '퀵 추가'}
          </button>
        </div>
      </div>
    </section>
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
        마감(위 &apos;영업 시간&apos; 카드의 마감 시각) · 다음날(00:00 이후 첫 접속) 시점에 자동 실행할 항목을 선택합니다.
        같은 항목을 두 시점 모두 켜면 두 번 실행됩니다 (대부분 무해). 둘 다 끄면 해당 시점에 실행되지 않습니다.
      </p>
      {loading ? (
        <div className="text-sm text-slate-400">로딩 중...</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-200">
              <th className="text-left font-medium py-2">항목</th>
              <th className="text-center font-medium py-2 w-24">마감<br /><span className="text-slate-400 font-normal">영업 마감 시각</span></th>
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
