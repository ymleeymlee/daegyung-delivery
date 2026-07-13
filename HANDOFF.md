# 대경배송시스템 — 작업 인수인계 (2026-07-13 갱신)

내부 직원용 배송 배차 + 고품(반품/회수 물품) 관리 시스템. 실시간 웹앱 + Google Sheets 기록.
**진행 중인 큰 작업: 라이더 위치추적.** 웹 1단계(실시간 지도)는 완료, **다음은 안드로이드(키오스크) 앱 개발** (아래 "라이더 위치추적 프로젝트" 섹션이 최신 · 이어서 여기부터).

> 🟥 **마이그레이션 적용 여부 확인 필요** (Supabase SQL Editor에서 직접 Run. RLS 경고 시 "Run without RLS"):
> - `supabase/update_09.sql` — `gopoum_items`에 `quantity`(기본1), `note`
> - `supabase/update_10.sql` — `gopoum_items`에 `collectors`(jsonb, 기본 `[]`)
> - `supabase/update_11.sql` — `riders`에 `phone`(text)
> - `supabase/update_12.sql` — 위치추적: `rider_locations`·`location_pings` 생성, 창고 설정(app_state), deliveries ETA 필드. **/tracking 지도는 떴으나 라이더 점이 안 찍히면 이게 미적용.** (앱이 write하기 시작하면 확인 가능)
> 09/10은 고품 수량·부분수거 동작하면 적용된 것. 11은 라이더 전번 저장으로, 12는 라이더 위치 저장으로 확인.

> 🟩 **'배달'→'배송' 전면 교체 + Drive 문서 리네임 완료.** 마감 시트는 `배송-MM`/`고품-MM` 찾음. (위치는 `위치-MM` — phase 2에서 사용, 문서는 사람이 미리 생성해야 함)

---

## 라이더 위치추적 프로젝트 (2026-07-13 착수) — ⭐ 이어서 여기부터

**목표:** 라이더 지급 키오스크폰으로 위치를 실시간 추적 → 웹에서 지도로 보고 + 기록 저장 → (추후) 배송카드별 동선.

**확정된 설계 (변경 금지선):**
- **백엔드는 기존 Supabase 하나로 공유** (분리 안 함 — 분리하면 riders 중복·조인 지옥). 위치는 독립 테이블로 격리.
- **실시간 지도 대시보드 = 기존 웹의 `/tracking` 페이지** (별도 앱 아님). Nav 관리▼에 '실시간 위치' 링크 있음.
- **지도 = 카카오맵 JS SDK.** ETA/동선까지 같은 SDK로 확장 예정. (한국 자동차 길찾기는 카카오/TMap/네이버만 됨 — Google 불가)
- **키오스크 = 기존 제품(Fully Kiosk Browser & Launcher) 사용**, Device Owner 잠금 + 허용앱(전화·카메라·사진·블루투스·무전기·우리앱) 화이트리스트 + 우리앱 부팅 자동실행. **런처는 우리가 안 만듦.**
- **우리가 만들 안드로이드 앱 = 네이티브 Kotlin (Compose + supabase-kt)**, 역할 = 라이더 세션 게이트 + 백그라운드 위치 전송(생산자). 지도는 안 봄. 프로젝트 위치 예정: `~/Desktop/daegyung-rider-app` (별도 git 저장소).
- **시트 저장은 배달회차 요약** (창고이탈→복귀 1회=1행). 원시 핑은 DB에만.
- 창고 임시 좌표: 개포동 `37.4787, 127.0664`, 반경 100m (app_state에 저장, 값만 바꾸면 됨. 실제 창고는 추후).

**1단계 = 완료 (커밋 `f24c8d2`~`f36f1b3`):**
- `update_12.sql`: `rider_locations`(라이더당 1행, 실시간 구독 대상), `location_pings`(append, 기록/동선용, 마감해도 보관), app_state 창고설정, deliveries에 `dest_lat/lng·eta_seconds·baseline_arrival_at`(optional, phase2용).
- `src/types/index.ts`: `RiderLocation`, `LocationPing`, Delivery ETA 필드(optional).
- `src/app/tracking/page.tsx`: 카카오맵 + 라이더 실시간 마커 + 창고 마커/지오펜스 원 + 운행목록 패널 + 로드 진단 배너.
- 카카오 세팅 완료: 앱ID `1512122`, JS키 `NEXT_PUBLIC_KAKAO_MAP_KEY`(.env.local + Vercel prod/preview). **JS SDK 도메인 등록 위치 = 새 콘솔 [앱>플랫폼 키>JavaScript 키>JavaScript SDK 도메인]** (기존 '플랫폼' 메뉴 없어짐, 헤맴 주의). 등록: `https://daegyung-delivery.vercel.app`, `http://localhost:3000`. 등록 후 반영에 몇 분 걸림. **REST키도 발급돼 있음** → phase2 카카오모빌리티 길찾기(ETA)용.

**다음 할 일 (2단계 후보 순서):**
1. **안드로이드 앱 착수** (핵심 · 이게 있어야 지도에 점 찍힘): 라이더 리스트(riders에서 `is_quick=false` 조회)→세션 고정 → 포그라운드 위치서비스로 `rider_locations` upsert + `location_pings` insert. 퇴근/충전 시 세션 해제. (RLS off라 supabase-kt 직접 write)
2. **지오펜스 + 알람 + 회차**: 창고 이탈=배달시작 알람 + `delivery_trips`(신규 `update_13`) 생성, 복귀=완료 알람+trip 종료. 판정은 폰이.
3. **마감 시 `위치-MM` 시트**: `googleSheets.ts writeLocationTab` + `sheetSnapshot.ts buildLocationGrid`(라이더|회차|출발|복귀|소요|거리|핑수) → `/api/close`에 추가.
4. **ETA/지연**: 카카오 로컬(주소→좌표) + 카카오모빌리티 길찾기(교통반영 duration)로 `baseline_arrival_at` 계산, /tracking·배송카드에 지연 표시. 쿼터 있으니 배정시 1회+간격 갱신으로 throttle, REST키는 서버(API route)에 숨김.
5. **배송카드별 동선 지도**: `location_pings`로 폴리라인.

---

## 최근 세션 변경 (2026-07-13) — 위 인수인계 본문보다 이게 최신

이 세션 커밋 범위: `4da6bdf`(dnd-kit 제거) ~ `b3246f1`(고품 줄맞춤).

1. **`@dnd-kit/*` 3개 패키지 제거** (미사용, 드래그 배차 삭제 잔존분).
2. **완전수거 후 수량↑ 버그 수정** (`DeliveryCard.tsx`): 고품 카드 판정을 `picked_at` → **실제 수거량(`isFull`=collectedTotal≥quantity)** 기준으로. 완전수거된 뒤 수량을 늘려 미완료가 되면 새 배송카드가 다시 노란 고품 카드로 잡힘. 더불어 `gopoum/page.tsx` **수량 편집 시 `picked_at` 재계산**(미완료면 null로 비워 마감 이월 보장).
3. **고품 수량 +/- 연타 깜빡임 수정**: `gopoum/page.tsx` 실시간 재조회를 **500ms 디바운스**(`DeliveryBoard`와 동일 패턴). 오래된 서버 응답이 낙관적 값을 덮어써 숫자가 튀던 문제 해결.
4. **라이더 전화번호** (`update_11.sql`, `riders/page.tsx`, `types`): `riders.phone`. 라이더 관리에서 추가·**목록 인라인 편집**, **자동 하이픈 포맷**(`01087000078`→`010-8700-0078`, 10자리 3-3-4 / 11자리 3-4-4). 배송현황 라이더 이름블록 옆에 전번 **상시 표시**(`RiderSection`).
5. **대기열 접기** (`DeliveryBoard.tsx`): `queueOpen` state, **기본 숨김**. 헤더 ▶ 클릭 토글. 카드 추가(QuickAddBar) 시 자동 펼침.
6. **배송카드 고품 팝업에 비고 표시** (`DeliveryCard.tsx` `GopoumModal`): 각 아이템 밑에 `비고` 라벨+흰 배경칩으로 표시.
7. **고품현황 수거자 영역 재구성** (`gopoum/page.tsx`): 수거자별로 **한 줄씩** — 열 순서 `수거날짜 · 수거시간 · 수거자 · 수거량`(모두 `leading-5` 고정 줄높이로 줄맞춤, 빈 줄은 nbsp). 이름 옆 `(n)` 제거하고 **수거량은 별도 열**. 잔여 있으면 마지막에 `미수거`(주황) 줄 + 잔여수량. **기존 `수거량/총` 열 삭제**(앞 `수량` 열과 중복).
8. **마감 시 고품 시트 부분수거·잔여 반영** (`sheetSnapshot.ts buildGopoumGrid` 재작성): 이전엔 `picked_at`/`rider_name`(완전수거일 때만 채워짐) 기반이라 **부분수거 아이템이 시트에 `미수거`로만 기록**되던 문제 해결. 이제 `collectors` 기반 — **수거자 여러 명이면 수거자별로 행 분리**, 열: `업체번호 | 업체명 | 수거 | 총수량 | 생성날짜 | 생성시간 | 품목 | 수거날짜 | 수거시각 | 수거자 | 수거량/총 | 비고`. 업체정보는 업체 첫 행만, 품목정보는 품목 첫 행만.

### 다음 후보 / 미해결
- **마감 시 부분수거 이월 동작**: 부분수거(수거<총량) 품목은 `picked_at` null이라 마감 때 아카이브 안 되고 **다음날로 이월**(정상). 단 그러면 **다음날 시트에도 다시 기록**됨(일별 스냅샷이라 의도된 동작이나, 월 합산 시 중복 주의).
- 배정된 카드를 클릭으로 대기열 복귀시키는 단건 경로 없음(다중선택 복귀 `handleReturnToQueue`는 있음).
- 이메일 발송(`/api/daily-report`, Resend) 여전히 미설정.

---

## 안드로이드 앱 연동 참고 (신규 개발용)

웹과 **같은 Supabase 프로젝트**를 백엔드로 공유하면 됨. 웹은 Next.js지만 앱은 Supabase에 직접 붙으면 실시간까지 그대로 동작.

- **연결 정보**: `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel 환경변수에도 동일). ⚠️ 이 파일은 `.gitignore`됨 — **키는 이 md/저장소에 적지 말 것**. 앱에선 Supabase Android SDK(`supabase-kt` 등)로 URL+anon key 사용.
- **인증/보안 현황**: **RLS 전부 비활성, 로그인 없음** (사내 신뢰망 전제). anon key로 읽기/쓰기 다 됨. 앱을 외부 배포하려면 RLS·인증 설계 먼저 필요 — 현재는 무방비.
- **실시간 테이블** (Realtime publication 등록됨): `deliveries`, `gopoum_clients`, `gopoum_items`, `app_state`. `postgres_changes`로 구독하면 웹과 동기화.
- **핵심 데이터 모델**: 아래 "데이터 모델 (Supabase)" 섹션 + `src/types/index.ts`가 소스 오브 트루스. 특히 `gopoum_items.collectors` jsonb(`[{delivery_id, rider_name, quantity, picked_at}]`) 규칙과 `picked_at`=완전수거 시각(부분이면 null) 불변식 준수 필요.
- **서버 경유가 필요한 동작**: 고품 아이템 추가/수거/삭제는 웹에선 `/api/gopoum-items`(service role, RLS 우회)로 감. 앱은 RLS off라 Supabase 직접 write 가능하나, **로직(예: 완전수거 시 `picked_at`·`rider_name` 세팅, 수량 편집 시 `picked_at` 재계산)을 클라이언트가 동일하게 구현**해야 웹과 일관.
- **마감**: 웹의 `GET /api/close`(Vercel) 1곳에서만 수행 권장. 앱에서 별도 마감 로직 만들지 말고 이 엔드포인트 호출 또는 웹에 위임.
- **날짜/시간**: 전부 KST(`Asia/Seoul`) 기준. `app_state.date_offset`(테스트용 가상 날짜) 존재 — 앱도 `effNow = now + offset일` 규칙 인지.

---

# (이하 2026-07-10 기준 인수인계 — 위 최근 변경으로 일부 대체됨)

내부 직원용 배송 배차 + 고품(반품/회수 물품) 관리 시스템. 실시간 웹앱 + Google Sheets 기록.

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
- `gopoum_items(id, gopoum_client_id, description, quantity, note, collectors, rider_name, delivery_id, picked_at, created_at, archived_at)` — 고품 품목 단위
  - `quantity`(update_09) = 총 수거해야 할 수량, `note`(update_09) = 비고
  - `collectors`(update_10, jsonb) = `[{delivery_id, rider_name, quantity, picked_at}]` 배송자별 수거량(부분·다중 수거)
  - `picked_at` = **완전수거(수거합계≥총량)** 시각(부분이면 null), `rider_name` = 수거자명 합친 문자열
  - `archived_at` 있으면 마감 처리됨(현황서 제거)
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
