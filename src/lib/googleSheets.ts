import { google, sheets_v4, drive_v3 } from 'googleapis'

// OAuth2 사용자 위임 인증 (custom.my.car.official@gmail.com 계정 위임)
// 서비스 계정은 Drive 저장 용량이 없어서 파일 생성 시 quota 에러가 남.
// OAuth 로 사용자 계정 quota(15GB) 를 사용해 파일을 생성한다.
// refresh_token 은 만료 없음(계정 비번 변경 or 6개월 미사용 시만 만료).
let _auth: InstanceType<typeof google.auth.OAuth2> | null = null
function getAuth() {
  if (_auth) return _auth
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN 중 하나 이상 미설정')
  }
  const oauth = new google.auth.OAuth2(clientId, clientSecret)
  oauth.setCredentials({ refresh_token: refreshToken })
  _auth = oauth
  return oauth
}

let _sheets: sheets_v4.Sheets | null = null
let _drive: drive_v3.Drive | null = null
function sheetsClient() { return (_sheets ??= google.sheets({ version: 'v4', auth: getAuth() })) }
function driveClient() { return (_drive ??= google.drive({ version: 'v3', auth: getAuth() })) }

// === 파일 구조 ===
// 루트 폴더: '대경배달기록'  (관리자가 수동 생성, 자동 생성 안 함)
// 파일:  {branchCode}_{cat}_{year}     (예: as_dlv_2026, gn_pos_2026)
//   · dlv 배송  · rec 고품  · pos 위치  · und 지하위치
// 탭:   MM_DD                          (예: 09_28)
// 지하위치는 탭 'all' 하나에 년도 내 누적.

const ROOT_FOLDER_NAME = '대경배달기록'
export type SheetCat = 'dlv' | 'rec' | 'pos' | 'und'

const _folderCache = new Map<string, string>()
async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const cacheKey = `${parentId ?? '*'}/${name}`
  if (_folderCache.has(cacheKey)) return _folderCache.get(cacheKey)!
  const drive = driveClient()
  const parentClause = parentId ? ` and '${parentId}' in parents` : ''
  const res = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`,
    fields: 'files(id,name)', pageSize: 1,
  })
  const id = res.data.files?.[0]?.id ?? null
  if (id) _folderCache.set(cacheKey, id)
  return id
}

let _rootId: string | null = null
async function getRootFolderId(): Promise<string> {
  if (_rootId) return _rootId
  const id = await findFolder(ROOT_FOLDER_NAME)
  if (!id) throw new Error(`루트 폴더 '${ROOT_FOLDER_NAME}' 를 찾을 수 없습니다. 관리자가 Google Drive 에서 수동 생성해야 합니다.`)
  _rootId = id
  return id
}

// 파일명 → docId. 없으면 생성 (루트 폴더 안).
const _docCache = new Map<string, string>()
async function findOrCreateSheet(fileName: string, opts?: { autoCreate?: boolean }): Promise<string | null> {
  if (_docCache.has(fileName)) return _docCache.get(fileName)!
  const rootId = await getRootFolderId()
  const drive = driveClient()
  const res = await drive.files.list({
    q: `'${rootId}' in parents and name='${fileName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)', pageSize: 1,
  })
  const existingId = res.data.files?.[0]?.id
  if (existingId) { _docCache.set(fileName, existingId); return existingId }
  if (!opts?.autoCreate) return null
  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [rootId],
    },
    fields: 'id',
  })
  const newId = created.data.id
  if (!newId) throw new Error(`스프레드시트 '${fileName}' 생성 실패`)
  _docCache.set(fileName, newId)
  console.log(`[googleSheets] 신규 시트 생성: ${fileName} (id=${newId})`)
  return newId
}

// 탭이 없으면 생성
async function ensureTab(docId: string, title: string) {
  const sheets = sheetsClient()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: docId })
  if (meta.data.sheets?.some(s => s.properties?.title === title)) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: docId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  })
}

function fileNameFor(branchCode: string, cat: SheetCat, year: string): string {
  return `${branchCode}_${cat}_${year}`
}

// 일별 스냅샷 저장 — 파일 {code}_{cat}_{year} 의 MM_DD 탭 전체 덮어쓰기.
async function writeDayTab(
  branchCode: string,
  cat: SheetCat,
  year: string,
  month: string,
  day: string,
  grid: (string | number)[][],
) {
  const fileName = fileNameFor(branchCode, cat, year)
  const docId = await findOrCreateSheet(fileName, { autoCreate: true })
  if (!docId) throw new Error(`시트 문서 준비 실패: ${fileName}`)
  const tab = `${month}_${day}`
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

// === 카테고리별 저장 함수 (호출부 편의용 wrapper) ===
export async function writeDeliveryTab(branchCode: string, year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(branchCode, 'dlv', year, month, day, grid)
}
export async function writeGopoumTab(
  branchCode: string, year: string, month: string, day: string,
  grid: (string | number)[][], collectedRows: number[] = [],
) {
  await writeDayTab(branchCode, 'rec', year, month, day, grid)
  if (grid.length <= 1) return
  // 헤더 아래 전체 배경 흰색 리셋 후, 완전수거 행만 연회색 적용.
  const fileName = fileNameFor(branchCode, 'rec', year)
  const docId = await findOrCreateSheet(fileName, { autoCreate: false })
  if (!docId) return
  const sheets = sheetsClient()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: docId, fields: 'sheets(properties(sheetId,title))' })
  const tab = `${month}_${day}`
  const sheetId = meta.data.sheets?.find(s => s.properties?.title === tab)?.properties?.sheetId
  if (sheetId == null) return
  const cols = grid[0].length
  const requests: object[] = [{
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: grid.length, startColumnIndex: 0, endColumnIndex: cols },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  }]
  // 연속된 완전수거 행은 range 로 묶어서 요청 수 최소화
  const sorted = [...new Set(collectedRows)].sort((a, b) => a - b)
  const ranges: { start: number; end: number }[] = []
  for (const r of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && last.end === r) last.end = r + 1
    else ranges.push({ start: r, end: r + 1 })
  }
  for (const rng of ranges) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: rng.start, endRowIndex: rng.end, startColumnIndex: 0, endColumnIndex: cols },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })
  }
  // 헤더+데이터 전체에 기본 필터 적용. 기존 필터는 자동 대체됨.
  requests.push({
    setBasicFilter: {
      filter: {
        range: { sheetId, startRowIndex: 0, endRowIndex: grid.length, startColumnIndex: 0, endColumnIndex: cols },
      },
    },
  })
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: docId, requestBody: { requests } })
}
export async function writeLocationTab(branchCode: string, year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(branchCode, 'pos', year, month, day, grid)
}

// === 위치 탭 읽기 (아카이브 조회) ===
export async function readLocationTab(branchCode: string, year: string, month: string, day: string): Promise<string[][] | null> {
  const fileName = fileNameFor(branchCode, 'pos', year)
  const tab = `${month}_${day}`
  try {
    const docId = await findOrCreateSheet(fileName, { autoCreate: false })
    if (!docId) return null
    const sheets = sheetsClient()
    const meta = await sheets.spreadsheets.get({ spreadsheetId: docId, fields: 'sheets(properties(title))' })
    if (!meta.data.sheets?.some(s => s.properties?.title === tab)) return null
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: docId, range: tab })
    return (res.data.values as string[][] | undefined) ?? []
  } catch (e) {
    console.error(`readLocationTab(${branchCode}, ${year}, ${month}, ${day}) 실패:`, e)
    return null
  }
}

// === 지하위치 (년도 내 누적) ===
// 파일: {branchCode}_und_{year}, 탭: 'all'
// 컬럼: A 업체번호 | B 업체명 | C 주소 | D 감지 횟수 | E 첫 감지일 | F 마지막 감지일
export interface UndergroundEntry {
  code: string        // 업체번호 (upsert 키)
  name: string
  address: string
  date: string        // 감지일 (YYYY-MM-DD KST)
}

export async function upsertUndergroundEntries(branchCode: string, entries: UndergroundEntry[]): Promise<void> {
  if (entries.length === 0) return
  const year = entries[0]!.date.slice(0, 4)   // 감지일에서 년도 추출
  const fileName = fileNameFor(branchCode, 'und', year)
  const docId = await findOrCreateSheet(fileName, { autoCreate: true })
  if (!docId) throw new Error(`지하위치 시트 준비 실패: ${fileName}`)
  const sheets = sheetsClient()
  const tab = 'all'
  await ensureTab(docId, tab)
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: docId, range: `${tab}!A:F` })
  const rows = (existing.data.values as string[][] | undefined) ?? []
  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: docId, range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['업체번호', '업체명', '주소', '감지 횟수', '첫 감지일', '마지막 감지일']] },
    })
    rows.push(['업체번호', '업체명', '주소', '감지 횟수', '첫 감지일', '마지막 감지일'])
  }
  const codeToRowIndex = new Map<string, number>()
  for (let i = 1; i < rows.length; i++) {
    const code = rows[i]?.[0]?.trim()
    if (code) codeToRowIndex.set(code, i)
  }
  const updates: { range: string; values: (string | number)[][] }[] = []
  const appends: (string | number)[][] = []
  for (const e of entries) {
    const idx = codeToRowIndex.get(e.code)
    if (idx != null) {
      const row = rows[idx]
      const prevCount = parseInt(row[3] ?? '0', 10) || 0
      const first = row[4] || e.date
      const rowNum = idx + 1
      updates.push({ range: `${tab}!D${rowNum}:F${rowNum}`, values: [[prevCount + 1, first, e.date]] })
    } else {
      appends.push([e.code, e.name, e.address, 1, e.date, e.date])
    }
  }
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: docId,
      requestBody: { valueInputOption: 'RAW', data: updates.map(u => ({ range: u.range, values: u.values })) },
    })
  }
  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: docId, range: `${tab}!A:F`,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends },
    })
  }
}
