# 대경배달시스템 — 프로젝트 기록

내부 직원용 배달 배차 관리 시스템. 대기열에 들어온 배달을 라이더(이름 블록)에 배정하고, 당일 내역을 지점별로 집계·엑셀로 관리한다.

- 배포: Vercel (https://daegyung-delivery.vercel.app)
- 스택: Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · Supabase(Postgres + Realtime) · SheetJS(xlsx) · Resend(메일)
- 저장소: github.com/ymleeymlee/daegyung-delivery

> 참고: 이 Next.js는 브레이킹 체인지가 많은 버전이다. 코드 작성 전 `node_modules/next/dist/docs/` 참고 (AGENTS.md).

## 페이지 구성

네비게이션 순서: **배달 보드(`/`) · 배달 내역(`/records`) · 거래처 관리(`/clients`)**

### 배달 보드 (`/`) — `components/DeliveryBoard.tsx`
- 대기열 + 라이더 컬럼(일반) + 퀵 구역(`is_quick`)으로 구성. Supabase Realtime 구독으로 자동 갱신.
- **배달 추가(인라인)**: 대기열 헤더의 `QuickAddBar`. 업체번호·상호명·주소 3칸이 있고 어디에 입력해도 세 컬럼(`code`/`name`/`address`)을 `.or(ilike)`로 통합 검색. 후보 선택 시 3칸 자동 완성, "배달 추가"(또는 Enter)로 즉시 카드 생성. 팝업(`AddDeliveryModal`)은 폐지(파일은 미사용 상태로 잔존).
- **카드 배정 규칙(존 기반)** — `moveSelectedTo` / `handleCardClick`:
  - 대기열 카드 선택 → 이름 블록 아무 위치 터치: 그 라이더로 배정
  - 이름 블록 카드 선택 → 다른 이름 블록 터치: 이동 / 대기열 터치: 대기열 복귀
  - 같은 카드 재선택 or 바탕화면 클릭: 선택 해제
  - 카드 클릭은 존(zone)으로 라우팅. 같은 카드만 예외적으로 해제 처리.
- **즉시 반영(낙관적 업데이트)**: 배정·복귀·추가·삭제·드래그는 `setDeliveries`로 화면을 먼저 바꾸고 Supabase 저장은 백그라운드, 실패 시에만 `fetchAll()` 재동기화. (예전엔 DB 왕복+전체 재조회를 기다려 느렸음)
- **정렬**: 대기열·라이더 목록 모두 `sort_order` 오름차순. 새로 배정된 카드는 `max+1`이라 항상 목록 **맨 아래**에 표시.
- **삭제**: 대기/배정 구분 없이 **완전 삭제(hard delete)**. 되돌릴 수 없어 삭제 시 확인창. '취소(cancelled)' 상태·복원 기능은 폐지.

### 배달 내역 (`/records`) — `app/records/page.tsx`
- 날짜 선택(기본 오늘 KST, 최근 90일). 강남·안산 지점별로 **엑셀과 동일한 레이아웃** 표 렌더링.
- 레이아웃: 가로 = 라이더 이름, 그 아래 4열(상호·주소·주문시각·배정시각), 배달 1건 = 1행, 하단에 라이더별 건수 + `총 N군데 배달`.
- 지점별 **엑셀 다운로드** 버튼 → `dk_YYYY_MM_DD_gn.xlsx` / `_as.xlsx` (6시 메일 첨부와 동일 파일).
- 렌더·엑셀은 공통 로직 `lib/reportLayout.ts` 사용(서버/클라이언트 공유, Supabase 비의존).

### 거래처 관리 (`/clients`) — `app/clients/page.tsx`
- 업체번호·상호명·대표주소 테이블. **정렬: 업체번호(숫자 우선) 오름차순, 없으면 상호명순**(업체번호 없는 거래처는 뒤로).
- 엑셀 업로드(업체번호/거래처명/실거래처명/대표주소 파싱, 덮어쓰기/추가 선택).

## 데이터 모델 (Supabase) — `supabase/*.sql`
- `clients(id, code=업체번호, name, address, created_at)` — `update_02`에서 `code` 추가
- `riders(id, name, is_active, is_quick, location, created_at)` — `update_03`에서 `location` 추가. `location ∈ {gn=강남, as=안산}`, 기본 `gn`, `안산퀵`은 `as`. **배달의 지점은 배정된 라이더의 location을 따른다.**
- `deliveries(id, client_id, client_name, client_address, status, created_at, assigned_at, rider_id, sort_order)` — `status ∈ {waiting, assigned, completed, cancelled}` (cancelled는 사실상 미사용). RLS 비활성.
- 마이그레이션은 Supabase SQL Editor에서 `schema.sql → update_01 → update_02 → update_03` 순 실행. **update_03은 운영 DB에 적용 완료.**

## 자동화 (Vercel Cron) — `vercel.json`
KST 기준 시각을 UTC로 환산해 설정.
- **매일 18:00 KST (`0 9 * * *`) → `/api/daily-report`**: 당일 배달내역을 지점별 엑셀로 만들어 Resend로 관리자에게 첨부 발송. 배달 없는 지점은 생략.
- **매일 07:00 KST (`0 22 * * *`) → `/api/daily-reset`**: ①cancelled 완전 삭제 → ②waiting/assigned를 completed로 아카이브(보드 비움) → ③completed 중 90일 지난 기록 영구 삭제.
- 두 라우트는 `CRON_SECRET`이 있으면 `Authorization: Bearer` 검증. 서버 접근은 `lib/supabaseServer.ts`(service role 키, 없으면 anon 폴백).

## 환경변수 (`.env.local.example`)
- 필수(클라): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- 크론/메일(서버): `SUPABASE_SERVICE_ROLE_KEY`(선택), `RESEND_API_KEY`, `ADMIN_EMAIL`, `REPORT_FROM_EMAIL`(기본 onboarding@resend.dev), `CRON_SECRET`
- **미완료 항목: 이메일 발송.** Resend 계정 가입 + 위 메일 환경변수 설정이 남음. 설정 전까지 6시 리포트는 데이터만 생성하고 메일은 발송되지 않음.

## 작업 방식 / 관례
- 수정 → 로컬(`npm run dev`)에서 확인 → 마지막에 한 번 커밋/푸시. 각 변경마다 즉시 푸시하지 않음.
- 이 환경(샌드박스)에서는 `.git` 잠금 파일 삭제 권한 문제로 커밋이 막혀, 사용자가 터미널에서 직접 푸시함:
  ```
  cd ~/Desktop/daegyung-delivery
  find .git -name '*.lock' -delete
  git add -A && git commit -m "..." && git push origin main
  ```
- 검증: `npx tsc --noEmit`. (마운트 폴더에서 `next build`는 `.next` 정리 단계 EPERM으로 실패하니, 필요 시 별도 경로로 복사해 빌드.)
