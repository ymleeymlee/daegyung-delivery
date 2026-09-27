import { supabaseServer } from '@/lib/supabaseServer'
import { NextRequest } from 'next/server'

// INSERT: 고품 아이템 추가
export async function POST(request: NextRequest) {
  const { gopoum_client_id, description, car_type, quantity, note } = await request.json()
  const row: Record<string, unknown> = { gopoum_client_id, description }
  if (car_type !== undefined) row.car_type = car_type
  if (typeof quantity === 'number' && quantity > 0) row.quantity = quantity
  if (note !== undefined) row.note = note
  const { data, error } = await supabaseServer
    .from('gopoum_items')
    .insert(row)
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
