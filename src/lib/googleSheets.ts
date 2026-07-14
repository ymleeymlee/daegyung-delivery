import { google, sheets_v4, drive_v3 } from 'googleapis'

// 서비스 계정 인증 (Drive 문서 탐색 + Sheets 읽기/쓰기)
function getAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_B64 미설정')
  const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  })
}

let _sheets: sheets_v4.Sheets | null = null
let _drive: drive_v3.Drive | null = null
function sheetsClient() { return (_sheets ??= google.sheets({ version: 'v4', auth: getAuth() })) }
function driveClient() { return (_drive ??= google.drive({ version: 'v3', auth: getAuth() })) }

// 이름으로 폴더 찾기 (연도 폴더: 예 '2026')
const _folderCache = new Map<string, string>()
async function findFolder(name: string): Promise<string | null> {
  if (_folderCache.has(name)) return _folderCache.get(name)!
  const drive = driveClient()
  const res = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)', pageSize: 1,
  })
  const id = res.data.files?.[0]?.id ?? null
  if (id) _folderCache.set(name, id)
  return id
}

// 연도 폴더 안에서 문서 찾기 (예: 2026 폴더 안 '배송-07')
const _docCache = new Map<string, string>()
async function findDocInYear(year: string, docName: string): Promise<string> {
  const cacheKey = `${year}/${docName}`
  if (_docCache.has(cacheKey)) return _docCache.get(cacheKey)!
  const folderId = await findFolder(year)
  if (!folderId) throw new Error(`폴더 '${year}' 를 찾을 수 없습니다`)
  const drive = driveClient()
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name='${docName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)', pageSize: 1,
  })
  const id = res.data.files?.[0]?.id
  if (!id) throw new Error(`'${docName}' 문서를 ${year} 폴더에서 찾을 수 없습니다`)
  _docCache.set(cacheKey, id)
  return id
}

// 탭(일별: 'MM-DD')이 없으면 생성
async function ensureTab(docId: string, title: string) {
  const sheets = sheetsClient()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: docId })
  if (meta.data.sheets?.some(s => s.properties?.title === title)) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: docId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  })
}

// 일별 탭에 현황 스냅샷 저장 (마감 시 1회, 전체 덮어쓰기)
async function writeDayTab(docName: string, year: string, month: string, day: string, grid: (string | number)[][]) {
  const docId = await findDocInYear(year, docName)
  const tab = `${month}-${day}`
  const sheets = sheetsClient()
  await ensureTab(docId, tab)
  await sheets.spreadsheets.values.clear({ spreadsheetId: docId, range: tab })
  if (grid.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: docId, range: `${tab}!A1`,
      valueInputOption: 'RAW', requestBody: { values: grid },
    })
  }
}

// 배송-MM 문서의 MM-DD 탭에 저장
export async function writeDeliveryTab(year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(`배송-${month}`, year, month, day, grid)
}
// 고품-MM 문서의 MM-DD 탭에 저장
export async function writeGopoumTab(year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(`고품-${month}`, year, month, day, grid)
}
// 위치-MM 문서의 MM-DD 탭에 저장 (마감 시 하루치 이동 기록 아카이브)
export async function writeLocationTab(year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(`위치-${month}`, year, month, day, grid)
}
