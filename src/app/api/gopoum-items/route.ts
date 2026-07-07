import { supabaseServer } from '@/lib/supabaseServer'
import { NextRequest } from 'next/server'

// INSERT: 고품 아이템 추가
export async function POST(request: NextRequest) {
  const { gopoum_client_id, description } = await request.json()
  const { data, error } = await supabaseServer
    .from('gopoum_items')
    .insert({ gopoum_client_id, description })
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json(data)
}

// PATCH: 아이템 수거 처리
export async function PATCH(request: NextRequest) {
  const { id, ...updates } = await request.json()
  const { data, error } = await supabaseServer
    .from('gopoum_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json(data)
}

// DELETE: 아이템 삭제
export async function DELETE(request: NextRequest) {
  const { id } = await request.json()
  const { error } = await supabaseServer.from('gopoum_items').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 400 })
  return Response.json({ ok: true })
}
