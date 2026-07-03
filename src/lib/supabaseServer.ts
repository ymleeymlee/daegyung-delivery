import { createClient } from '@supabase/supabase-js'

// 서버(크론/API 라우트) 전용 Supabase 클라이언트.
// service role 키가 있으면 사용하고, 없으면 anon 키로 폴백 (RLS 비활성 상태라 동작).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabaseServer = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
})
