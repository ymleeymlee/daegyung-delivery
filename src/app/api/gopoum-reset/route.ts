import { supabaseServer } from '@/lib/supabaseServer'

export async function GET() {
  const now = new Date()
  const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)

  // 다음날 오전 8시 KST
  const [y, m, d] = kstDate.split('-').map(Number)
  const tomorrowStr = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const tomorrow8am = new Date(`${tomorrowStr}T08:00:00+09:00`).toISOString()

  const [{ data: clients }, { data: items }] = await Promise.all([
    supabaseServer.from('gopoum_clients').select('*'),
    supabaseServer.from('gopoum_items').select('id, gopoum_client_id, picked_at'),
  ])

  if (!clients) return Response.json({ error: 'fetch failed' }, { status: 500 })

  let updated = 0
  for (const gc of clients) {
    const clientItems = (items ?? []).filter((i: { gopoum_client_id: string }) => i.gopoum_client_id === gc.id)
    const remaining = clientItems.filter((i: { picked_at: string | null }) => !i.picked_at).length

    await supabaseServer.from('gopoum_clients').update({
      total_quantity: remaining,
      started_at: remaining > 0 ? tomorrow8am : null,
    }).eq('id', gc.id)
    updated++
  }

  return Response.json({ success: true, updated, date: kstDate })
}
