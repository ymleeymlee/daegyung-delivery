// 고품 정리 (auto_actions.gopoum_reset). midnight-check / closeRunner 가 공유.
// - 수거완료 품목: 이번 실행에서 시트 저장이 성공한 지점은 삭제 (이미 시트에 기록됨).
//   시트 저장 실패/미실행 지점은 archived_at 만 찍어 보존 → 기록 유실 방지.
// - 품목이 하나도 남지 않은 업체는 삭제.
// - 남은 업체는 미수거 품목 수로 total_quantity / started_at 갱신.

import { supabaseServer } from '@/lib/supabaseServer'

const CHUNK = 200

function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK))
  return out
}

async function fetchAll<T>(table: string, columns: string, activeOnly: boolean): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabaseServer.from(table).select(columns).order('id').range(from, from + PAGE - 1)
    if (activeOnly) q = q.is('archived_at', null)
    const { data, error } = await q
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

type ItemRow = { id: string; gopoum_client_id: string; picked_at: string | null }
type ClientRow = { id: string; branch: string | null }

export async function resetGopoum(sheetOkBranches: Set<string>, nowIso: string, tomorrow8am: string) {
  const [clients, activeItems] = await Promise.all([
    fetchAll<ClientRow>('gopoum_clients', 'id, branch', false),
    fetchAll<ItemRow>('gopoum_items', 'id, gopoum_client_id, picked_at', true),
  ])
  const branchOf = new Map(clients.map(c => [c.id, c.branch]))

  const picked = activeItems.filter(i => i.picked_at)
  const toDelete = picked.filter(i => sheetOkBranches.has(branchOf.get(i.gopoum_client_id) ?? '')).map(i => i.id)
  const toArchive = picked.filter(i => !sheetOkBranches.has(branchOf.get(i.gopoum_client_id) ?? '')).map(i => i.id)

  for (const ids of chunks(toDelete)) {
    const { error } = await supabaseServer.from('gopoum_items').delete().in('id', ids)
    if (error) console.error('gopoum_reset 품목 삭제 실패:', error)
  }
  for (const ids of chunks(toArchive)) {
    const { error } = await supabaseServer.from('gopoum_items').update({ archived_at: nowIso }).in('id', ids)
    if (error) console.error('gopoum_reset 품목 보존(archived_at) 실패:', error)
  }

  // 품목(보존분 포함)이 하나도 없는 업체 삭제
  const remaining = await fetchAll<{ gopoum_client_id: string }>('gopoum_items', 'gopoum_client_id', false)
  const hasItem = new Set(remaining.map(i => i.gopoum_client_id))
  const emptyClients = clients.filter(c => !hasItem.has(c.id)).map(c => c.id)
  for (const ids of chunks(emptyClients)) {
    const { error } = await supabaseServer.from('gopoum_clients').delete().in('id', ids)
    if (error) console.error('gopoum_reset 빈 업체 삭제 실패:', error)
  }

  const emptySet = new Set(emptyClients)
  await Promise.all(clients.filter(c => !emptySet.has(c.id)).map(c => {
    const rem = activeItems.filter(i => i.gopoum_client_id === c.id && !i.picked_at).length
    return supabaseServer.from('gopoum_clients')
      .update({ total_quantity: rem, started_at: rem > 0 ? tomorrow8am : null })
      .eq('id', c.id)
  }))

  return { deleted: toDelete.length, archived: toArchive.length, clientsDeleted: emptyClients.length }
}
