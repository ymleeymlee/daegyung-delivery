import { google, sheets_v4, drive_v3 } from 'googleapis'

// 서비스 계정 인증 (키는 base64 환경변수). Drive(문서 탐색) + Sheets(읽기/쓰기) 스코프
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

const FOLDER_ID = () => process.env.DRIVE_FOLDER_ID ?? '1FFu4_whlCpr1YcOCaifBlwGi8h2S-z5K'

// 정확한 이름의 스프레드시트 문서 찾기 (폴더 안 우선, 없으면 공유된 전체에서)
const _docCache = new Map<string, string>()
export async function findDoc(name: string): Promise<string | null> {
  if (_docCache.has(name)) return _docCache.get(name)!
  const drive = driveClient()
  const base = `name='${name}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
  // 1) 폴더 안에서 먼저
  let res = await drive.files.list({
    q: `'${FOLDER_ID()}' in parents and ${base}`,
    fields: 'files(id,name)', pageSize: 1,
  })
  // 2) 없으면 서비스 계정이 접근 가능한 전체에서 (직접 공유된 경우)
  if (!res.data.files?.length) {
    res = await drive.files.list({ q: base, fields: 'files(id,name)', pageSize: 1 })
  }
  const id = res.data.files?.[0]?.id ?? null
  if (id) _docCache.set(name, id)
  return id
}

// 월 탭(예: '07')이 없으면 생성
async function ensureMonthTab(docId: string, month: string) {
  const sheets = sheetsClient()
  const meta = await sheets.spreadsheets.get({ spreadsheetId: docId })
  if (meta.data.sheets?.some(s => s.properties?.title === month)) return
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: docId,
    requestBody: { requests: [{ addSheet: { properties: { title: month } } }] },
  })
}

const DATE_MARK = /^(\d{4}-\d{2}-\d{2})/

// 월 탭에서 특정 날짜(dateKey) 블록만 교체/추가하고 나머지 날짜는 보존 (일별 누적)
// block의 첫 행 첫 셀은 반드시 'YYYY-MM-DD ...' 로 시작해야 함 (날짜 마커)
export async function upsertDayBlock(
  docId: string, month: string, dateKey: string, block: (string | number)[][]
) {
  const sheets = sheetsClient()
  await ensureMonthTab(docId, month)

  // 기존 값 읽어 날짜별 블록으로 분리
  const cur = await sheets.spreadsheets.values.get({ spreadsheetId: docId, range: `${month}` })
  const rows = cur.data.values ?? []
  const blocks = new Map<string, (string | number)[][]>()
  const order: string[] = []
  let key: string | null = null
  for (const row of rows) {
    if (row.every(c => c === '' || c == null)) continue // 빈 줄 무시
    const m = String(row[0] ?? '').match(DATE_MARK)
    if (m) {
      key = m[1]
      blocks.set(key, []) // 같은 날짜 마커가 또 나오면 이전 블록 버리고 마지막 것만 유지 (중복 방지)
      if (!order.includes(key)) order.push(key)
    }
    if (key) blocks.get(key)!.push(row)
  }

  // 오늘 블록 교체 (없으면 추가)
  if (!blocks.has(dateKey)) order.push(dateKey)
  blocks.set(dateKey, block)
  order.sort() // 날짜 오름차순

  // 재조립 (블록 사이 빈 줄 1개)
  const out: (string | number)[][] = []
  for (const k of order) {
    for (const r of blocks.get(k)!) out.push(r)
    out.push([])
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId: docId, range: `${month}` })
  if (out.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: docId, range: `${month}!A1`,
      valueInputOption: 'RAW', requestBody: { values: out },
    })
  }
}

// 배달: 하루치 블록(라이더 가로표)을 날짜별로 누적
export async function writeDeliveryDay(year: string, month: string, dateKey: string, block: (string | number)[][]) {
  const docId = await findDoc(`배달_${year}`)
  if (!docId) throw new Error(`스프레드시트 '배달_${year}' 를 폴더에서 찾을 수 없습니다`)
  await upsertDayBlock(docId, month, dateKey, block)
}

// 고품: 업체별 행을 계속 누적(하루 블록으로 끊지 않음). 마지막 열이 날짜(YY-MM-DD).
const GOPOUM_HEADER = ['업체번호', '업체명', '찾아온', '총수량', '품목', '수거배달자', '수거시각', '날짜']
const GOPOUM_DATE_COL = 7 // 날짜 열 인덱스(0-based)

export async function writeGopoumRows(year: string, month: string, dateKey: string, todayRows: string[][]) {
  const docId = await findDoc(`고품_${year}`)
  if (!docId) throw new Error(`스프레드시트 '고품_${year}' 를 폴더에서 찾을 수 없습니다`)
  const sheets = sheetsClient()
  await ensureMonthTab(docId, month)

  const cur = await sheets.spreadsheets.values.get({ spreadsheetId: docId, range: `${month}` })
  const rows = cur.data.values ?? []
  // 기존 행 중: 날짜열이 있고(옛 형식 배제) + 오늘이 아닌 것만 보존
  const kept = rows.slice(1)
    .filter(r => r.length && r.some(c => c !== '' && c != null))
    .filter(r => r[GOPOUM_DATE_COL] && String(r[GOPOUM_DATE_COL]) !== dateKey)

  // 중복 제거: (업체번호|품목|날짜) 키로 최신(오늘 데이터) 우선
  const map = new Map<string, string[]>()
  for (const r of [...kept, ...todayRows]) {
    map.set(`${r[0] ?? ''}|${r[4] ?? ''}|${r[GOPOUM_DATE_COL] ?? ''}`, r)
  }
  const all = [...map.values()]
  // 날짜 오름차순 → 업체명 순
  all.sort((a, b) => {
    const da = String(a[GOPOUM_DATE_COL] ?? ''), db = String(b[GOPOUM_DATE_COL] ?? '')
    if (da !== db) return da < db ? -1 : 1
    return String(a[1] ?? '').localeCompare(String(b[1] ?? ''), 'ko')
  })

  const out = [GOPOUM_HEADER, ...all]
  await sheets.spreadsheets.values.clear({ spreadsheetId: docId, range: `${month}` })
  await sheets.spreadsheets.values.update({
    spreadsheetId: docId, range: `${month}!A1`,
    valueInputOption: 'RAW', requestBody: { values: out },
  })
}
