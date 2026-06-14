'use client'

import { useState, useEffect, useRef } from 'react'
import { Client } from '@/types'
import { supabase } from '@/lib/supabase'

interface Props {
  onClose: () => void
  onAdd: (clientName: string, clientAddress: string, clientId?: string) => void
}

export default function AddDeliveryModal({ onClose, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [address, setAddress] = useState('')
  const [results, setResults] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!query.trim() || selectedClient) { setResults([]); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('clients')
        .select('*')
        .ilike('name', `%${query}%`)
        .limit(8)
      setResults(data ?? [])
      setLoading(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, selectedClient])

  function selectClient(client: Client) {
    setSelectedClient(client)
    setQuery(client.name)
    setAddress(client.address)
    setResults([])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    onAdd(query.trim(), address.trim(), selectedClient?.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-slate-800 mb-4">배달 추가</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="relative">
            <label className="text-xs text-slate-500 mb-1 block">상호명</label>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedClient(null) }}
              placeholder="상호명 검색..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {(results.length > 0 || loading) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
                {loading && <div className="px-3 py-2 text-xs text-slate-400">검색 중...</div>}
                {results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors"
                    onClick={() => selectClient(c)}
                  >
                    <p className="text-sm text-slate-800 font-medium">{c.name}</p>
                    <p className="text-xs text-slate-400 truncate">{c.address}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">주소</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="주소 입력"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!query.trim()}
              className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              추가
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
