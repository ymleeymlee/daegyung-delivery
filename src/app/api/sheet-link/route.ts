import { NextRequest } from 'next/server'
import { findSheetId, type SheetCat } from '@/lib/googleSheets'

const CATS: SheetCat[] = ['dlv', 'rec', 'pos', 'und']

// 시트 바로가기: /api/sheet-link?cat=dlv&branch=as&year=2026 → 해당 파일의 편집 URL 로 302.
// 파일이 없으면 404 (자동 생성 안 함). 편집 권한은 Drive 공유 설정이 좌우함.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const cat = url.searchParams.get('cat') as SheetCat | null
  const branch = url.searchParams.get('branch')
  const year = url.searchParams.get('year')
  if (!cat || !branch || !year) return new Response('missing params (cat, branch, year)', { status: 400 })
  if (!CATS.includes(cat)) return new Response(`invalid cat '${cat}'`, { status: 400 })
  if (!/^\d{4}$/.test(year)) return new Response(`invalid year '${year}'`, { status: 400 })
  const docId = await findSheetId(branch, cat, year)
  if (!docId) return new Response(`시트 '${branch}_${cat}_${year}' 를 찾을 수 없습니다.`, { status: 404 })
  return Response.redirect(`https://docs.google.com/spreadsheets/d/${docId}/edit`, 302)
}
