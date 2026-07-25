'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { supabase } from './supabase'
import type { Branch } from '@/types'

const STORAGE_KEY = 'dg_branch'
const DEFAULT_BRANCH = 'as'

interface BranchContextValue {
  branch: string
  setBranch: (code: string) => void
  branches: Branch[]
}

const BranchContext = createContext<BranchContextValue>({
  branch: DEFAULT_BRANCH,
  setBranch: () => {},
  branches: [],
})

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [branches, setBranches] = useState<Branch[]>([])
  const [branch, setBranchState] = useState<string>(() => {
    const fromUrl = searchParams?.get('branch')
    if (fromUrl) return fromUrl
    if (typeof window !== 'undefined') {
      const fromStorage = window.localStorage.getItem(STORAGE_KEY)
      if (fromStorage) return fromStorage
    }
    return DEFAULT_BRANCH
  })

  const fetchBranches = useCallback(async () => {
    const { data } = await supabase.from('branches').select('*').order('sort_order')
    setBranches((data ?? []) as Branch[])
  }, [])

  useEffect(() => {
    fetchBranches()
    const channel = supabase
      .channel('branches-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'branches' }, fetchBranches)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchBranches])

  // branches 로드 후, URL/localStorage에 값이 없었으면 첫 항목으로 초기화
  useEffect(() => {
    if (branches.length === 0) return
    const fromUrl = searchParams?.get('branch')
    const fromStorage = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (!fromUrl && !fromStorage) {
      setBranchState(branches[0].code)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches])

  const setBranch = useCallback((code: string) => {
    setBranchState(code)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, code)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('branch', code)
    router.replace(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  return (
    <BranchContext.Provider value={{ branch, setBranch, branches }}>
      {children}
    </BranchContext.Provider>
  )
}

export function useBranch() {
  return useContext(BranchContext)
}
