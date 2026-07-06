import { supabaseServer } from '@/lib/supabaseServer'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('Authorization')
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const now = new Date()
  const kstDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
  const todayStart = new Date(`${kstDateStr}T00:00:00+09:00`).toISOString()
  const today6pm  = new Date(`${kstDateStr}T18:00:00+09:00`).toISOString()

  // 다음날 오전 8시 KST
  const [y, m, d] = kstDateStr.split('-').map(Number)
  const tomorrowStr = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const tomorrow8am = new Date(`${tomorrowStr}T08:00:00+09:00`).toISOString()

  const [{ data: clients }, { data: todayPickups }] = await Promise.all([
    supabaseServer.from('gopoum_clients').select('*'),
    supabaseServer
      .from('gopoum_pickups')
      .select('*')
      .gte('picked_at', todayStart)
      .lt('picked_at', today6pm),
  ])

  if (!clients) return Response.json({ error: 'fetch failed' }, { status: 500 })

  let updated = 0
  for (const gc of clients) {
    const picked = (todayPickups ?? [])
      .filter((p: { gopoum_client_id: string; quantity: number }) => p.gopoum_client_id === gc.id)
      .reduce((sum: number, p: { quantity: number }) => sum + p.quantity, 0)
    const remaining = Math.max(0, gc.total_quantity - picked)

    await supabaseServer
      .from('gopoum_clients')
      .update({
        total_quantity: remaining,
        started_at: remaining > 0 ? tomorrow8am : null,
      })
      .eq('id', gc.id)
    updated++
  }

  return Response.json({ success: true, updated, date: kstDateStr })
}
