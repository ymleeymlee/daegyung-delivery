# 대경배달시스템 — 작업 인수인계 (2026-07-10 기준)

내부 직원용 배달 배차 + 고품(반품/회수 물품) 관리 시스템. 실시간 웹앱 + Google Sheets 기록.

- **배포(운영)**: https://daegyung-delivery.vercel.app (main 브랜치 = 프로덕션)
- **저장소**: github.com/ymleeymlee/daegyung-delivery
- **로컬**: `~/Desktop/daegyung-delivery`
- **스택**: Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · Supabase(Postgres + Realtime) · googleapis(Sheets/Drive) · Vercel Cron

> ⚠️ Next.js 16은 브레이킹 체인지가 많음. 코드 작성 전 `node_modules/next/dist/docs/` 참고 (AGENTS.md).

---

## 핵심 개념

- **DB(Supabase)** = 오늘 진행 중인 실시간 현황만 저장 (배달 보드, 고품 현황)
- **Google Sheets** = 날짜별 최종 기록 저장소 (마감 시 스냅샷 기록). 사람이 보는 장부
- **마감** = 하루 종료. 현황을 시트에 저장하고 DB를 정리. 매일 밤 11:59 자동 + 수동 버튼

---

## 페이지 / 네비게이션

`src/components/Nav.tsx` (layout에 상주)
- **배달 현황** (`/`) — `components/DeliveryBoard.tsx`
- **고품 현황** (`/gopoum`) — `app/gopoum/page.tsx`
- **관리 ▼** 드롭다운:
  - 배달·고품 내역 → **Google Drive 폴더 링크**(시트로 대체, 앱 내 내역 페이지 안 씀)
  - 거래처 관리 (`/clients`)
  - 라이더 관리 (`/riders`)
- 우측: **현재 날짜** · **마감 버튼** · **다음날 →**(테스트) · **오늘로 리셋**(테스트, offset>0일 때만)

> `app/records`, `app/gopoum-records` 페이지 파일은 남아있으나 네비에서 안 가리킴(시트로 대체).

---

## 데이터 모델 (Supabase)

마이그레이션: `supabase/schema.sql → update_01 ~ update_08` 순. **전부 운영 DB 적용 완료.**

- `clients(id, code=업체번호, name, address, created_at)` — 680여 건
- `riders(id, name, is_active, is_quick, location['gn'|'as'], created_at)` — gn=강남, as=안산, is_quick=퀵구역
- `deliveries(id, client_id, client_name, client_address, status, created_at, assigned_at, rider_id, sort_order)`
  - status: waiting/assigned/completed/cancelled
  - **마감 시 전부 삭제됨** (시트에 기록되므로 DB에 안 쌓음)
- `gopoum_clients(id, client_id, client_code, client_name, total_quantity, created_at, started_at)` — 고품 있는 업체
- `gopoum_items(id, gopoum_client_id, description, rider_name, delivery_id, picked_at, created_at, archived_at)` — 고품 품목 단위
  - `picked_at` 있으면 수거됨, `archived_at` 있으면 마감 처리됨(현황서 제거)
- `app_state(key, value)` — `date_offset`(테스트용 날짜 오프셋), `closed_until`(마감 해제 시각 ISO)

RLS 전부 비활성. `app_state`, `gopoum_items` 등 realtime publication 등록됨.

---

## 배달 현황 (`DeliveryBoard.tsx`)

- 대기열 + 라이더 컬럼(강남→안산→퀵). Supabase Realtime 구독으로 자동 갱신. 낙관적 업데이트.
- **QuickAddBar**: 업체번호/상호/주소 통합검색. **같은 업체번호는 하나로 묶어 "경기모터스 외 3"** 표시·생성.
- 카드 배정: 카드 선택 → 라이더 클릭 or 드래그.
- **고품 연동(업체번호 기준)**: 배정된 카드에 `고품 N/M` 버튼(본인 수거/가져올 수 있는 총량). 누르면 팝업 → 미수거 아이템 버튼으로 수거/취소. 배정 당시 스냅샷 고정(이후 추가 품목은 과거 카드에 소급 안 됨). 타 배달자 수거분은 비활성.
- **마감 시** 배달 추가 차단.
- realtime 고품 재조회는 **500ms debounce** (빠른 연속 수거 시 선택 풀림 방지).

## 고품 현황 (`app/gopoum/page.tsx`)

- 업체별 카드(추가 순). 업체 추가(번호+명), 카드에 **+ 고품추가**(품목 텍스트).
- 아이템 표시: **생성날짜(YY-MM-DD) · 생성시간 · 품목명 · 수거시간(또는 -) · 수거자(또는 미수거)**
- 총수량 = 품목 수 자동. 개별 품목 삭제 가능.
- RLS 우회 위해 추가/수거/삭제는 `/api/gopoum-items` (서버, service role) 경유.

---

## Google Sheets 연동

- **구조**: `2026` 폴더(Drive) → `배달-07` / `고품-07` 문서(월별) → `07-10` 탭(일별)
- 서비스 계정: `daegyung-writer@daegyung-sheets.iam.gserviceaccount.com` (Drive 공유 필요)
- **매년/매월 준비**: `YYYY` 폴더 안에 `배달-MM`, `고품-MM` 문서 2개를 사람이 미리 생성 (서비스계정은 파일 생성 불가 — 개인 Gmail 정책)
- `src/lib/googleSheets.ts`: `findFolder(년)` → `findDocInYear(월문서)` → `writeDeliveryTab`/`writeGopoumTab`(일탭 덮어쓰기)
- `src/lib/sheetSnapshot.ts`: `buildGrids(riders,deliveries,clients,items)` → 그리드, `writeSnapshot(dateStr,data)` → 시트 쓰기
- **실시간 sync 없음.** 마감 때만 1회 기록.
- 시트 열:
  - 배달: 라이더 가로 배치(강남→안산→퀵), 각 4열(상호·주소·주문시각·배정시각)
  - 고품: `업체번호 | 업체명 | 수거 | 총수량 | 생성날짜 | 생성시간 | 품목 | 수거시각 | 수거자` (업체 정보는 첫 행만, 품목부터 행 추가)

---

## 마감 (`app/api/close/route.ts`)

- **자동**: 매일 23:59 KST (`vercel.json` cron `59 14 * * *`)
- **수동**: Nav 마감 버튼 → `GET /api/close`
- 동작(성능 최적화됨, ~1초):
  1. 현황+상태를 **1회 병렬 조회**
  2. 스냅샷 그리드 생성(동기)
  3. **정리 전부 병렬**: 배달 전체 삭제 · 수거 고품 archived · 업체별 잔여수량 갱신 · `closed_until`(다음날 06:00) 저장
  4. **시트 저장은 `after()`로 백그라운드** (Google API가 느려서 응답 후 처리)
- 마감 후 다음날 06:00까지 마감 버튼 비활성(`마감됨`). 배달 추가 차단. 시트 sync도 마감 상태면 스킵.
- 고품: 수거된 품목 제거, **미수거는 잔여로 이월**(started_at=다음날 8시).

## 테스트용 날짜 도구

- `app_state.date_offset`로 "가상 현재 날짜" 이동. 유효 현재 = 실제 now + offset일.
- **다음날 →**: offset+1 + 마감 해제 (마감→다음날 기록 테스트)
- **오늘로 리셋**: offset=0 + 마감 해제 (실제 운영 전 반드시 실행)
- `src/lib/appState.ts`: `fetchAppState`, `setDateOffset`, `clearClosed`, `isClosedNow`, `effNow`

---

## 작업 관례 / 환경

- **현재 main = 운영.** 커밋/푸시하면 바로 프로덕션 배포. (sheets-integration 브랜치는 머지 후 삭제됨)
- 커밋: `git add -A && git commit && git push origin main` → Vercel 자동 배포. 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 검증: `npx tsc --noEmit`
- 로컬 확인: `npm run dev` (localhost:3000). 단, **사용자는 외부(아이패드)에서 접속하므로 실제 확인은 배포 후 운영 URL로.**
- **Google 서비스 계정 키**: `gcp-key.json` (프로젝트 루트, `.gitignore`됨. 절대 커밋 금지)
- **Vercel 환경변수**(production+preview): `GOOGLE_SERVICE_ACCOUNT_B64`(키 base64), `DRIVE_FOLDER_ID`, `NEXT_PUBLIC_SHEET_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **SQL 실행**: 자동화(Management API/키보드)가 보안·권한으로 막힘. 스키마 변경 시 **사용자가 Supabase SQL Editor에서 직접 Run** 해야 함. RLS 경고 뜨면 "Run without RLS".
- **Vercel/GitHub CLI**: `npx vercel`(ymleeymlee 로그인됨), `gh`는 `/tmp/gh_cli/...`에 있음.

## 주의점

- 서비스 계정은 **파일 생성 불가**(개인 Gmail 정책) → 시트 문서는 사람이 미리 만들어야. 폴더에 넣으면 공유 상속됨.
- 실제 운영 시작 전 **오늘로 리셋**으로 `date_offset=0` 확인.
- 테스트용 버튼(다음날/오늘로 리셋)은 운영에도 노출 중. 떼려면 `Nav.tsx`에서 제거.

## 미해결 / 다음 후보

- 이메일 발송(`/api/daily-report`, Resend) — 미설정 상태로 잔존
- 페이지 초기 로딩 체감(로딩 표시만 추가됨, 근본 최적화는 안 함)
- 옛 파일 잔재: `AddDeliveryModal.tsx`, `records`/`gopoum-records` 페이지, `daily-reset`/`gopoum-reset` API (미사용)
