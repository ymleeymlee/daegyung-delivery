'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Client } from '@/types'
import * as XLSX from 'xlsx'

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchClients = useCallback(async () => {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .order('name')
    setClients(data ?? [])
  }, [])

  useEffect(() => { fetchClients() }, [fetchClients])

  const filtered = clients.filter(c =>
    c.name.includes(search) || c.address.includes(search)
  )

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    await supabase.from('clients').insert({ name: newName.trim(), address: newAddress.trim() })
    setNewName('')
    setNewAddress('')
    setAdding(false)
    fetchClients()
  }

  async function handleUpdate(id: string) {
    await supabase.from('clients').update({ name: editName.trim(), address: editAddress.trim() }).eq('id', id)
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
      const rows = XLSX.utils.sheet_to_json<{ 상호명: string; 주소: string }>(ws)
      const valid = rows.filter(r => r['상호명']).map(r => ({
        name: String(r['상호명']).trim(),
        address: String(r['주소'] ?? '').trim(),
      }))
      if (valid.length === 0) { setUploadStatus('유효한 데이터가 없습니다.'); return }
      const { error } = await supabase.from('clients').insert(valid)
      if (error) throw error
      setUploadStatus(`${valid.length}개 등록 완료`)
      fetchClients()
    } catch {
      setUploadStatus('업로드 실패')
    }
    if (fileRef.current) fileRef.current.value = ''
    setTimeout(() => setUploadStatus(''), 3000)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">거래처 관리</h1>
        <div className="flex items-center gap-2">
          {uploadStatus && (
            <span className="text-sm text-blue-600 font-medium">{uploadStatus}</span>
          )}
          <label className="cursor-pointer flex items-center gap-1 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm px-3 py-1.5 rounded-xl transition-colors">
            <span>엑셀 업로드</span>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
          </label>
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
              <th className="text-left px-4 py-3 text-slate-600 font-semibold">상호명</th>
              <th className="text-left px-4 py-3 text-slate-600 font-semibold">주소</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <tr className="border-b border-slate-100 bg-blue-50">
                <td className="px-4 py-2">
                  <input
                    autoFocus
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
                    placeholder="주소"
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
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400">거래처가 없습니다.</td>
              </tr>
            )}
            {filtered.map(client => (
              <tr key={client.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                {editingId === client.id ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        autoFocus
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
