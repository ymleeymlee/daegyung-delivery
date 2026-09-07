// OAuth Refresh Token 획득 스크립트 (1회 실행용)
//
// 사용법:
//   GOOGLE_OAUTH_CLIENT_ID="..." \
//   GOOGLE_OAUTH_CLIENT_SECRET="..." \
//   node scripts/get-refresh-token.mjs
//
// 실행하면:
//  1) 로컬 서버(포트 3333) 띄우고
//  2) 브라우저가 열림 → custom.my.car.official@gmail.com 로 로그인·동의
//  3) 콘솔에 refresh_token 이 출력됨 → Vercel env GOOGLE_OAUTH_REFRESH_TOKEN 에 저장
//
// Desktop app 타입은 http://localhost 리다이렉트가 자동 허용됨.

import { google } from 'googleapis'
import http from 'node:http'
import { exec } from 'node:child_process'
import fs from 'node:fs'

// env 또는 --creds <json path> 로 client_id/client_secret 지정
let CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
let CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const credsFlag = process.argv.indexOf('--creds')
if (credsFlag > -1 && process.argv[credsFlag + 1]) {
  const j = JSON.parse(fs.readFileSync(process.argv[credsFlag + 1], 'utf8'))
  CLIENT_ID ??= j.client_id
  CLIENT_SECRET ??= j.client_secret
}
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('client_id / client_secret 를 env 또는 --creds <json> 로 지정하세요.')
  process.exit(1)
}

const PORT = 3333
const REDIRECT_URI = `http://localhost:${PORT}/callback`

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',   // refresh_token 을 받기 위해 필수
  prompt: 'consent',        // 항상 동의 화면 띄워서 refresh_token 확실히 받기
  scope: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
  ],
})

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`)
  if (u.pathname !== '/callback') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const code = u.searchParams.get('code')
  const err = u.searchParams.get('error')
  if (err) {
    res.end(`OAuth 에러: ${err}. 터미널로 돌아가세요.`)
    console.error('OAuth 에러:', err)
    setTimeout(() => process.exit(1), 500)
    return
  }
  if (!code) {
    res.end('code 파라미터가 없습니다.')
    setTimeout(() => process.exit(1), 500)
    return
  }
  try {
    const { tokens } = await oauth2.getToken(code)
    res.end('완료! 이 창을 닫고 터미널로 돌아가세요.')
    console.log('\n=== 결과 ===')
    console.log('refresh_token:', tokens.refresh_token || '(없음 — 이미 동의된 앱이라 안 왔을 수 있음. GCP 콘솔에서 이 앱 권한 해제 후 재시도)')
    console.log('access_token :', tokens.access_token)
    console.log('scope        :', tokens.scope)
    console.log('\n다음: 아래 3개 값을 Vercel 환경변수로 등록하세요.')
    console.log('  GOOGLE_OAUTH_CLIENT_ID     =', CLIENT_ID)
    console.log('  GOOGLE_OAUTH_CLIENT_SECRET =', CLIENT_SECRET)
    console.log('  GOOGLE_OAUTH_REFRESH_TOKEN =', tokens.refresh_token)
    setTimeout(() => process.exit(0), 500)
  } catch (e) {
    res.end(`토큰 교환 실패: ${e.message}`)
    console.error('토큰 교환 실패:', e)
    setTimeout(() => process.exit(1), 500)
  }
})

server.listen(PORT, () => {
  console.log(`\n로컬 서버 시작: ${REDIRECT_URI}`)
  console.log('브라우저를 여는 중...')
  console.log('브라우저가 안 뜨면 아래 URL 을 직접 열어주세요:\n')
  console.log(authUrl)
  console.log('')
  exec(`open '${authUrl}'`)
})
