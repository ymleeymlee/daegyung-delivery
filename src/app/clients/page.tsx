'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Client } from '@/types'
import * as XLSX from 'xlsx'

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editName, setEditName] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [showUploadChoice, setShowUploadChoice] = useState(false)
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const uploadModeRef = useRef<'append' | 'replace'>('append')
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchClients = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('*')
    // 업체번호 순 정렬. 업체번호가 있으면 숫자(없으면 문자) 오름차순 우선,
    // 업체번호가 없는 거래처는 뒤로 보내고 상호명 순으로 정렬
    const sorted = (data ?? []).slice().sort((a, b) => {
      const ca = (a.code ?? '').trim()
      const cb = (b.code ?? '').trim()
      if (ca && cb) {
        const na = Number(ca)
        const nb = Number(cb)
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
        if (ca !== cb) return ca.localeCompare(cb, 'ko')
        return a.name.localeCompare(b.name, 'ko')
      }
      if (ca && !cb) return -1
      if (!ca && cb) return 1
      return a.name.localeCompare(b.name, 'ko')
    })
    setClients(sorted)
  }, [])

  useEffect(() => { fetchClients() }, [fetchClients])

  const filtered = clients.filter(c =>
    c.name.includes(search) || c.address.includes(search) || c.code.includes(search)
  )

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    await supabase.from('clients').insert({ code: newCode.trim(), name: newName.trim(), address: newAddress.trim() })
    setNewCode('')
    setNewName('')
    setNewAddress('')
    setAdding(false)
    fetchClients()
  }

  async function handleUpdate(id: string) {
    await supabase.from('clients').update({ code: editCode.trim(), name: editName.trim(), address: editAddress.trim() }).eq('id', id)
    setEditingId(null)
    fetchClients()
  }

  async function handleDelete(id: string) {
    if (!confirm('거래처를 삭제할까요?')) return
    await supabase.from('clients').delete().eq('id', id)
    fetchClients()
  }

  function startEdit(client: Client) {
    setEditingId(client.id)
    setEditCode(client.code)
    setEditName(client.name)
    setEditAddress(client.address)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadStatus('파싱 중...')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

      // 헤더 공백 제거 후 필요한 열만 추출: 업체번호, 거래처명, 실거래처명, 대표주소
      const pick = (row: Record<string, unknown>, key: string) => {
        const found = Object.keys(row).find(k => k.replace(/\s/g, '') === key)
        return found != null ? String(row[found] ?? '').trim() : ''
      }

      const parsed = rows
        .map(r => {
          const code = pick(r, '업체번호')
          const clientName = pick(r, '거래처명')
          const realName = pick(r, '실거래처명')
          const address = pick(r, '대표주소')
          // 상호명은 실거래처명 사용, 없으면 거래처명
          return { code, name: realName || clientName, address }
        })
        .filter(r => r.name)

      // 파일 내 중복(업체번호+상호명 동일)은 하나로 합치기 — 주소 있는 행 우선
      const byKey = new Map<string, { code: string; name: string; address: string }>()
      for (const r of parsed) {
        const key = `${r.code}|${r.name}`
        const prev = byKey.get(key)
        if (!prev || (!prev.address && r.address)) byKey.set(key, r)
      }
      const valid = [...byKey.values()]

      if (valid.length === 0) { setUploadStatus('유효한 데이터가 없습니다.'); return }

      let toInsert = valid
      let skipped = parsed.length - valid.length

      if (uploadModeRef.current === 'replace') {
        // 기존 데이터 전부 삭제 후 새로 등록
        setUploadStatus('기존 데이터 삭제 중...')
        const { error: delError } = await supabase.from('clients').delete().not('id', 'is', null)
        if (delError) throw delError
      } else {
        // 이미 등록된 거래처는 건너뛰기 (업체번호가 위탁/법인 등으로 공유되므로 업체번호+상호명 조합으로 판정)
        const existing = new Set(clients.map(c => `${c.code}|${c.name}`))
        toInsert = valid.filter(r => !existing.has(`${r.code}|${r.name}`))
        skipped = parsed.length - toInsert.length
        if (toInsert.length === 0) { setUploadStatus(`전체 ${valid.length}개 모두 이미 등록됨`); return }
      }

      const { error } = await supabase.from('clients').insert(toInsert)
      if (error) throw error
      setUploadStatus(`${toInsert.length}개 등록 완료${skipped > 0 ? ` (중복 ${skipped}개 제외)` : ''}`)
      fetchClients()
    } catch {
      setUploadStatus('업로드 실패')
    }
    if (fileRef.current) fileRef.current.value = ''
    setTimeout(() => setUploadStatus(''), 3000)
  }

  function chooseAppend() {
    uploadModeRef.current = 'append'
    setShowUploadChoice(false)
    fileRef.current?.click()
  }

  function chooseReplace() {
    setShowUploadChoice(false)
    setShowReplaceConfirm(true)
  }

  function confirmReplace() {
    uploadModeRef.current = 'replace'
    setShowReplaceConfirm(false)
    fileRef.current?.click()
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {showUploadChoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowUploadChoice(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-800 mb-4">엑셀 업로드 방식 선택</h2>
            <div className="flex flex-col gap-2">
              <button
                onClick={chooseReplace}
                className="w-full border border-red-300 text-red-600 hover:bg-red-50 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
              >
                기존 삭제하고 새로 올리기
              </button>
              <button
                onClick={chooseAppend}
                className="w-full border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
              >
                기존에 추가하기
              </button>
              <button
                onClick={() => setShowUploadChoice(false)}
                className="w-full text-slate-400 hover:text-slate-600 text-sm px-4 py-2 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {showReplaceConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowReplaceConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-red-600 mb-2">주의</h2>
            <p className="text-sm text-slate-700 mb-4">기존 데이터는 전부 지워집니다.<br />계속하시겠습니까?</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowReplaceConfirm(false)}
                className="text-sm text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-xl transition-colors"
              >
                취소
              </button>
              <button
                onClick={confirmReplace}
                className="text-sm bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2 rounded-xl transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">거래처 관리</h1>
        <div className="flex items-center gap-2">
          {uploadStatus && (
            <span className="text-sm text-blue-600 font-medium">{uploadStatus}</span>
          )}
          <button
            onClick={() => setShowUploadChoice(true)}
            className="flex items-center gap-1 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm px-3 py-1.5 rounded-xl transition-colors"
          >
            엑셀 업로드
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
          <button
            onClick={() => setAdding(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-xl transition-colors"
          >
            + 거래처 추가
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="상호명 또는 주소 검색..."
          className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-slate-600 font-semibold w-28">업체번호</th>
              <th className="text-left px-4 py-3 text-slate-600 font-semibold">상호명</th>
              <th className="text-left px-4 py-3 text-slate-600 font-semibold">대표주소</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="border-b border-slate-100 bg-blue-50">
                <td className="px-4 py-2">
                  <input
                    autoFocus
                    value={newCode}
                    onChange={e => setNewCode(e.target.value)}
                    placeholder="업체번호"
                    className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="상호명"
                    className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={newAddress}
                    onChange={e => setNewAddress(e.target.value)}
                    placeholder="대표주소"
                    className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="px-4 py-2 flex gap-1">
                  <button onClick={handleAdd} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700">저장</button>
                  <button onClick={() => setAdding(false)} className="text-xs text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-100">취소</button>
                </td>
              </tr>
            )}
            {filtered.length === 0 && !adding && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">거래처가 없습니다.</td>
              </tr>
            )}
            {filtered.map(client => (
              <tr key={client.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                {editingId === client.id ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        autoFocus
                        value={editCode}
                        onChange={e => setEditCode(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={editAddress}
                        onChange={e => setEditAddress(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button onClick={() => handleUpdate(client.id)} className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700">저장</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-100">취소</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-slate-500">{client.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{client.name}</td>
                    <td className="px-4 py-3 text-slate-500">{client.address}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => startEdit(client)} className="text-xs text-slate-500 hover:text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors">수정</button>
                        <button onClick={() => handleDelete(client.id)} className="text-xs text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">삭제</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-400">
          총 {filtered.length}개 {search && `(전체 ${clients.length}개 중)`}
        </div>
      </div>
    </div>
  )
}
