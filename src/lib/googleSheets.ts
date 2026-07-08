import { google, sheets_v4 } from 'googleapis'

// 서비스 계정 인증 (키는 base64로 환경변수에 저장)
function getAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_B64 미설정')
  const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

let _client: sheets_v4.Sheets | null = null
export function sheetsClient(): sheets_v4.Sheets {
  if (!_client) _client = google.sheets({ version: 'v4', auth: getAuth() })
  return _client
}

export const SHEET_ID = () => process.env.GOOGLE_SHEET_ID ?? ''
export const SHEET_URL = () => `https://docs.google.com/spreadsheets/d/${SHEET_ID()}/edit`

// 탭(시트)이 없으면 생성하고 sheetId 반환
export async function ensureTab(title: string): Promise<number> {
  const sheets = sheetsClient()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID() })
  const existing = meta.data.sheets?.find(s => s.properties?.title === title)
  if (existing) return existing.properties!.sheetId!

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  })
  return res.data.replies![0].addSheet!.properties!.sheetId!
}

// 탭 내용을 통째로 교체 (스냅샷 방식): 기존 값 클리어 후 새 값 쓰기
export async function writeTab(title: string, values: (string | number)[][]) {
  const sheets = sheetsClient()
  await ensureTab(title)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID(),
    range: `${title}`,
  })
  if (values.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID(),
      range: `${title}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    })
  }
}
