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

// 이름으로 폴더 찾기. parentId 를 주면 그 폴더 "바로 아래"에서만 찾는다.
// (지점 폴더는 최상위에서, 카테고리 폴더는 지점 폴더 하위에서 찾도록 명시적으로 제한)
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

// 폴더가 없으면 만들어서 반환. parentId 는 필수 (아무데나 만들지 않도록).
async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const found = await findFolder(name, parentId)
  if (found) return found
  const drive = driveClient()
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  })
  const id = res.data.id
  if (!id) throw new Error(`폴더 '${name}' 생성 실패 (parent=${parentId})`)
  _folderCache.set(`${parentId}/${name}`, id)
  console.log(`[googleSheets] 신규 폴더 생성: ${name} (id=${id}, parent=${parentId})`)
  return id
}

// 지점/카테고리 폴더 안에서 문서(YY-MM) 찾기. autoCreate=true 면 없을 때 생성.
// 카테고리 폴더도 자동 생성한다(지점 폴더는 절대 자동 생성 안 함 — 오탈자 시 엉뚱한 곳에 만들면 곤란).
const _docCache = new Map<string, string>()
async function findDoc(
  branchFolder: string,
  category: '배송' | '고품' | '위치',
  yy: string,
  mm: string,
  opts?: { autoCreate?: boolean },
): Promise<string | null> {
  const docName = `${yy}-${mm}`
  const cacheKey = `${branchFolder}/${category}/${docName}`
  if (_docCache.has(cacheKey)) return _docCache.get(cacheKey)!

  const branchId = await findFolder(branchFolder)
  if (!branchId) {
    if (opts?.autoCreate) throw new Error(`지점 폴더 '${branchFolder}' 를 찾을 수 없습니다 (지점 폴더는 자동 생성 안 함)`)
    return null
  }

  // 카테고리 폴더: autoCreate 이면 없을 때 생성, 아니면 없으면 null
  const categoryId = opts?.autoCreate
    ? await findOrCreateFolder(category, branchId)
    : await findFolder(category, branchId)
  if (!categoryId) return null

  const drive = driveClient()
  const res = await drive.files.list({
    q: `'${categoryId}' in parents and name='${docName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)', pageSize: 1,
  })
  const existingId = res.data.files?.[0]?.id
  if (existingId) {
    _docCache.set(cacheKey, existingId)
    return existingId
  }
  if (!opts?.autoCreate) return null

  // 신규 스프레드시트 생성 (지점/카테고리 폴더 하위)
  const created = await drive.files.create({
    requestBody: {
      name: docName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [categoryId],
    },
    fields: 'id',
  })
  const newId = created.data.id
  if (!newId) throw new Error(`스프레드시트 '${docName}' 생성 실패 (${branchFolder}/${category})`)
  _docCache.set(cacheKey, newId)
  console.log(`[googleSheets] 신규 시트 생성: ${branchFolder}/${category}/${docName} (id=${newId})`)
  return newId
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
// 파일 구조: 지점/카테고리/YY-MM, 파일 없으면 자동 생성.
async function writeDayTab(
  branchFolder: string,
  category: '배송' | '고품' | '위치',
  year: string,
  month: string,
  day: string,
  grid: (string | number)[][],
) {
  const yy = year.slice(-2)
  const docId = await findDoc(branchFolder, category, yy, month, { autoCreate: true })
  if (!docId) throw new Error(`시트 문서 준비 실패: ${branchFolder}/${category}/${yy}-${month}`)
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

// 배송/YY-MM 문서의 MM-DD 탭에 저장 (지점 폴더 하위)
export async function writeDeliveryTab(branchFolder: string, year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(branchFolder, '배송', year, month, day, grid)
}
// 고품/YY-MM 문서의 MM-DD 탭에 저장 (지점 폴더 하위)
export async function writeGopoumTab(branchFolder: string, year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(branchFolder, '고품', year, month, day, grid)
}
// 위치/YY-MM 문서의 MM-DD 탭에 저장 (마감 시 하루치 이동 기록 아카이브, 지점 폴더 하위)
export async function writeLocationTab(branchFolder: string, year: string, month: string, day: string, grid: (string | number)[][]) {
  await writeDayTab(branchFolder, '위치', year, month, day, grid)
}

/**
 * 지하위치(누적 관리) 시트: 지점/지하위치/전체 스프레드시트의 첫 탭에 upsert.
 * 컬럼: A 업체번호 | B 업체명 | C 주소 | D 감지 횟수 | E 첫 감지일 | F 마지막 감지일
 * 같은 업체번호가 있으면 감지 횟수 +1, 마지막 감지일 갱신. 없으면 append.
 */
export interface UndergroundEntry {
  code: string        // 업체번호 (upsert 키)
  name: string
  address: string
  date: string        // 감지일 (YYYY-MM-DD KST)
}

async function findOrCreateUndergroundDoc(branchFolder: string): Promise<string> {
  const drive = driveClient()
  const branchId = await findFolder(branchFolder)
  if (!branchId) throw new Error(`지점 폴더 '${branchFolder}' 를 찾을 수 없습니다 (지점 폴더는 자동 생성 안 함)`)
  const categoryId = await findOrCreateFolder('지하위치', branchId)
  const docName = '전체'
  const cacheKey = `${branchFolder}/지하위치/${docName}`
  if (_docCache.has(cacheKey)) return _docCache.get(cacheKey)!
  const res = await drive.files.list({
    q: `'${categoryId}' in parents and name='${docName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)', pageSize: 1,
  })
  const existingId = res.data.files?.[0]?.id
  if (existingId) { _docCache.set(cacheKey, existingId); return existingId }
  const created = await drive.files.create({
    requestBody: {
      name: docName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [categoryId],
    },
    fields: 'id',
  })
  const newId = created.data.id
  if (!newId) throw new Error(`지하위치 스프레드시트 생성 실패 (${branchFolder})`)
  _docCache.set(cacheKey, newId)
  console.log(`[googleSheets] 신규 시트 생성: ${branchFolder}/지하위치/${docName} (id=${newId})`)
  return newId
}

export async function upsertUndergroundEntries(branchFolder: string, entries: UndergroundEntry[]): Promise<void> {
  if (entries.length === 0) return
  const docId = await findOrCreateUndergroundDoc(branchFolder)
  const sheets = sheetsClient()
  // 첫 탭 이름 확보 (기본 'Sheet1' or 한국어 로케일 '시트1' 가능)
  const meta = await sheets.spreadsheets.get({ spreadsheetId: docId, fields: 'sheets(properties(title,sheetId))' })
  const firstSheet = meta.data.sheets?.[0]?.properties
  const tab = firstSheet?.title ?? 'Sheet1'
  // 기존 데이터 조회 (헤더 포함)
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: docId, range: `${tab}!A:F` })
  const rows = (existing.data.values as string[][] | undefined) ?? []
  // 헤더 없으면 삽입
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
      // 감지 횟수 · 마지막 감지일만 갱신 (업체명/주소는 유지 — 관리자가 수정한 경우 존중)
      const rowNum = idx + 1  // sheet row (1-based)
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

// 위치/YY-MM 문서의 MM-DD 탭 읽기 (아카이브 조회용). 탭/문서 없으면 null.
// (조회용이므로 자동 생성 안 함.)
export async function readLocationTab(branchFolder: string, year: string, month: string, day: string): Promise<string[][] | null> {
  const yy = year.slice(-2)
  const tab = `${month}-${day}`
  try {
    const docId = await findDoc(branchFolder, '위치', yy, month)
    if (!docId) return null
    const sheets = sheetsClient()
    // 탭 존재 확인 (없는 탭 조회 시 400 대신 조용히 null 반환)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: docId, fields: 'sheets(properties(title))' })
    if (!meta.data.sheets?.some(s => s.properties?.title === tab)) return null
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: docId, range: tab })
    return (res.data.values as string[][] | undefined) ?? []
  } catch (e) {
    // 접근 불가 등 → null 로 취급 (호출측이 안내)
    console.error(`readLocationTab(${branchFolder}, ${year}, ${month}, ${day}) 실패:`, e)
    return null
  }
}
